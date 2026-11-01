import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { isIP } from 'node:net'
import {
  AtemPacketFlag,
  ATEM_PACKET_HEADER_BYTES,
  ATEM_PACKET_MAX_BYTES,
  decodeAtemCommandRecords,
  decodeAtemPacket,
  encodeAtemCommandRecord,
  encodeAtemPacket,
  hasAtemPacketFlag,
  nextAtemSequence,
  type AtemPacket,
} from './packet-codec.js'
import { applyAtemCommand } from './command-decoder.js'
import type { AtemProtocolControl } from './control.js'
import {
  createInitialStateRecords,
  createStateChangeRecords,
  type AtemDeviceProfile,
} from './state-projection.js'

const RETRY_INTERVAL_MS = 75
const MAX_RETRIES = 5
const HEARTBEAT_MS = 1_000
const SESSION_TIMEOUT_MS = 6_000
const SESSION_SWEEP_MS = 50
const SYN_RESPONSE_RESERVED_FIELD = 0x00d1
const HANDSHAKE_RETRY_INTERVAL_MS = 250
const MAX_HANDSHAKE_RETRIES = 8
const MAX_SESSIONS = 64
const MAX_OUTBOX_PACKETS = 128
const RETRANSMIT_REQUEST_INTERVAL_MS = 50

export interface AtemProtocolLogger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string, error?: unknown): void
}

export interface AtemProtocolServerOptions {
  host: string
  port: number
  device: AtemDeviceProfile
  control: AtemProtocolControl
  logger: AtemProtocolLogger
  onClientCountChanged?: (count: number) => void
}

export type AtemProtocolStatus = 'stopped' | 'listening'

type SessionPhase = 'awaiting-handshake-ack' | 'ready'

interface PendingPacket {
  buffer: Uint8Array
  sentAt: number
  attempts: number
}

interface AtemSession {
  endpointKey: string
  address: string
  port: number
  sessionId: number
  clientHelloSessionId: number
  phase: SessionPhase
  nextOutboundSequence: number
  lastInboundSequence: number
  lastSeenAt: number
  lastOutboundAt: number
  handshakeResponse: Uint8Array
  handshakeSentAt: number
  handshakeAttempts: number
  lastInboundRetransmitAt: number
  lastOutboundRetransmitAt: number
  outbox: Map<number, PendingPacket>
}

type InboundSequenceResult = 'accepted' | 'duplicate' | 'gap'

/**
 * A deliberately small UDP switcher endpoint. It implements the transport
 * semantics used by the pinned `atem-connection` client without importing that
 * library at runtime, and projects all controls to the shared state facade.
 */
export class AtemProtocolServer {
  private socket: Socket | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private unsubscribe: (() => void) | undefined
  private readonly sessions = new Map<string, AtemSession>()
  private device: AtemDeviceProfile
  private status: AtemProtocolStatus = 'stopped'
  private boundPort: number | undefined

  public constructor(private readonly options: AtemProtocolServerOptions) {
    this.device = { ...options.device }
  }

  /**
   * Changes the identity sent in future initial state dumps. Existing clients
   * keep their negotiated profile until they reconnect.
   */
  public setDeviceProfile(device: AtemDeviceProfile): void {
    this.device = { ...device }
  }

  /**
   * Profile/topology changes invalidate the initial state negotiated by every
   * existing client. Clear their UDP sessions so they reconnect and receive a
   * coherent snapshot for the replacement sandbox.
   */
  public clearSessions(): void {
    if (this.sessions.size === 0) {
      return
    }
    this.sessions.clear()
    this.emitClientCount()
  }

  public async start(): Promise<void> {
    if (this.status === 'listening') {
      return
    }

    if (isIP(this.options.host) === 6) {
      throw new Error('ATEM Sandbox v1 currently supports IPv4 UDP hosts only.')
    }

    const socket = createSocket('udp4')
    this.socket = socket
    socket.on('message', (message, remote) => {
      try {
        this.handleMessage(message, remote)
      } catch (error) {
        this.options.logger.error('ATEM UDP message handler failed.', error)
      }
    })
    socket.on('error', (error) => this.options.logger.error('ATEM UDP socket error.', error))

    try {
      await new Promise<void>((resolveStart, rejectStart) => {
        const fail = (error: Error): void => {
          socket.off('listening', resolveStart)
          rejectStart(error)
        }
        socket.once('error', fail)
        socket.once('listening', () => {
          socket.off('error', fail)
          resolveStart()
        })
        socket.bind(this.options.port, this.options.host)
      })
    } catch (error) {
      this.socket = undefined
      socket.close()
      throw error
    }

    const address = socket.address()
    this.boundPort = typeof address === 'string' ? undefined : address.port
    this.status = 'listening'
    this.unsubscribe = this.options.control.subscribe((change) => {
      try {
        const records = createStateChangeRecords(change, this.device)
        if (records.length > 0) {
          this.broadcastRecords(records)
        }
      } catch (error) {
        this.options.logger.error('Unable to project an ATEM state update.', error)
      }
    })
    this.timer = setInterval(() => this.sweepSessions(), SESSION_SWEEP_MS)
  }

  public async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    this.sessions.clear()
    this.emitClientCount()
    this.status = 'stopped'
    this.boundPort = undefined

    const socket = this.socket
    this.socket = undefined
    if (socket === undefined) {
      return
    }
    await new Promise<void>((resolveStop) => {
      socket.close(() => resolveStop())
    })
  }

  public getStatus(): AtemProtocolStatus {
    return this.status
  }

  public getPort(): number | undefined {
    return this.boundPort
  }

  public getClientCount(): number {
    let count = 0
    for (const session of this.sessions.values()) {
      if (session.phase === 'ready') {
        count += 1
      }
    }
    return count
  }

  private handleMessage(message: Buffer, remote: RemoteInfo): void {
    let packet: AtemPacket
    try {
      packet = decodeAtemPacket(message)
    } catch (error) {
      this.options.logger.debug(
        `Ignored malformed ATEM UDP datagram from ${remote.address}:${remote.port}: ${describeError(error)}`,
      )
      return
    }

    const endpointKey = this.endpointKey(remote)
    if (hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.NewSession)) {
      this.handleNewSession(endpointKey, remote, packet.header.sessionId)
      return
    }

    const session = this.sessions.get(endpointKey)
    if (session === undefined || packet.header.sessionId !== session.sessionId) {
      this.options.logger.debug(
        `Ignored ATEM UDP packet with an unknown session from ${remote.address}:${remote.port}.`,
      )
      return
    }
    session.lastSeenAt = Date.now()

    if (hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.AckReply)) {
      this.acknowledge(session, packet.header.acknowledgementNumber)
      if (session.phase === 'awaiting-handshake-ack' && packet.header.acknowledgementNumber === 0) {
        this.sendInitialState(session)
      }
    }

    if (hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.RetransmitRequest)) {
      this.resendFrom(session, packet.header.retransmitFrom)
    }

    if (hasAtemPacketFlag(packet.header.flags, AtemPacketFlag.AckRequest)) {
      const result = this.acceptInboundSequence(session, packet.header.packetSequence)
      if (result === 'accepted') {
        this.sendAck(session, session.lastInboundSequence)
        this.handleControlPayload(session, packet.payload)
      } else if (result === 'duplicate') {
        this.sendAck(session, session.lastInboundSequence)
      } else {
        this.requestRetransmission(session)
      }
    }
  }

  private handleNewSession(
    endpointKey: string,
    remote: RemoteInfo,
    clientHelloSessionId: number,
  ): void {
    const existing = this.sessions.get(endpointKey)
    const now = Date.now()
    if (existing !== undefined && existing.clientHelloSessionId === clientHelloSessionId) {
      existing.lastSeenAt = now
      if (
        existing.phase === 'awaiting-handshake-ack' &&
        now - existing.handshakeSentAt >= RETRANSMIT_REQUEST_INTERVAL_MS
      ) {
        this.sendHandshake(existing)
      }
      return
    }
    if (existing === undefined && this.sessions.size >= MAX_SESSIONS) {
      this.options.logger.warn(
        `Ignored ATEM UDP session request from ${remote.address}:${remote.port}; session limit reached.`,
      )
      return
    }

    const sessionId = this.allocateSessionId()
    const handshakeResponse = encodeAtemPacket(
      {
        flags: AtemPacketFlag.NewSession,
        sessionId,
        retransmitTo: SYN_RESPONSE_RESERVED_FIELD,
        packetSequence: 0,
      },
      Uint8Array.of(2, 0, 0, 0, 0, 0, 0, 0),
    )
    const session: AtemSession = {
      endpointKey,
      address: remote.address,
      port: remote.port,
      sessionId,
      clientHelloSessionId,
      phase: 'awaiting-handshake-ack',
      nextOutboundSequence: 1,
      lastInboundSequence: 0,
      lastSeenAt: now,
      lastOutboundAt: now,
      handshakeResponse,
      handshakeSentAt: 0,
      handshakeAttempts: 0,
      lastInboundRetransmitAt: 0,
      lastOutboundRetransmitAt: 0,
      outbox: new Map(),
    }
    const hadReadyClient = existing?.phase === 'ready'
    this.sessions.set(endpointKey, session)
    this.sendHandshake(session)
    if (hadReadyClient) {
      this.emitClientCount()
    }
    this.options.logger.info(`ATEM UDP session requested from ${remote.address}:${remote.port}.`)
  }

  private sendInitialState(session: AtemSession): void {
    if (session.phase !== 'awaiting-handshake-ack') {
      return
    }
    const records = createInitialStateRecords(this.options.control.getState(), this.device)
    this.sendReliableRecords(session, records)
    if (this.sessions.get(session.endpointKey) !== session) {
      return
    }
    session.phase = 'ready'
    this.emitClientCount()
    this.options.logger.info(`ATEM UDP client connected from ${session.address}:${session.port}.`)
  }

  private handleControlPayload(session: AtemSession, payload: Uint8Array): void {
    if (payload.byteLength === 0) {
      return
    }
    try {
      for (const command of decodeAtemCommandRecords(payload)) {
        if (command.command === 'RMDR' || command.command === 'SRDR') {
          const requestedRecord = command.command === 'RMDR' ? 'RTMR' : 'SRST'
          const records = createInitialStateRecords(
            this.options.control.getState(),
            this.device,
          ).filter((record) => record.command === requestedRecord)
          if (records.length > 0) {
            this.sendReliableRecords(session, records)
          }
          continue
        }
        const result = applyAtemCommand(command, this.options.control)
        if (!result.accepted) {
          this.options.logger.debug(
            `Ignored ATEM command ${command.command} from ${session.address}:${session.port}: ${result.reason ?? 'unsupported'}`,
          )
        }
      }
    } catch (error) {
      this.options.logger.debug(
        `Ignored malformed ATEM command payload from ${session.address}:${session.port}: ${describeError(error)}`,
      )
    }
  }

  private broadcastRecords(records: readonly { command: string; payload: Uint8Array }[]): void {
    for (const session of this.sessions.values()) {
      if (session.phase === 'ready') {
        this.sendReliableRecords(session, records)
      }
    }
  }

  private sendReliableRecords(
    session: AtemSession,
    records: readonly { command: string; payload: Uint8Array }[],
  ): void {
    const maximumPayloadBytes = ATEM_PACKET_MAX_BYTES - ATEM_PACKET_HEADER_BYTES
    let current: Uint8Array[] = []
    let currentLength = 0

    for (const record of records) {
      const encoded = encodeAtemCommandRecord(record)
      if (encoded.byteLength > maximumPayloadBytes) {
        this.options.logger.warn(`Skipped oversized ATEM record ${record.command}.`)
        continue
      }
      if (currentLength > 0 && currentLength + encoded.byteLength > maximumPayloadBytes) {
        if (!this.sendReliablePayload(session, joinEncodedRecords(current, currentLength))) {
          return
        }
        current = []
        currentLength = 0
      }
      current.push(encoded)
      currentLength += encoded.byteLength
    }

    if (currentLength > 0) {
      this.sendReliablePayload(session, joinEncodedRecords(current, currentLength))
    }
  }

  private sendReliablePayload(session: AtemSession, payload: Uint8Array): boolean {
    if (session.outbox.size >= MAX_OUTBOX_PACKETS) {
      this.dropSession(
        session,
        `ATEM UDP client ${session.address}:${session.port} exceeded the unacknowledged packet limit.`,
      )
      return false
    }
    const sequence = session.nextOutboundSequence
    session.nextOutboundSequence = nextAtemSequence(sequence)
    const buffer = encodeAtemPacket(
      {
        flags: AtemPacketFlag.AckRequest,
        sessionId: session.sessionId,
        packetSequence: sequence,
      },
      payload,
    )
    session.outbox.set(sequence, { buffer, sentAt: Date.now(), attempts: 0 })
    this.send(buffer, session)
    return true
  }

  private sendAck(session: AtemSession, sequence: number): void {
    const buffer = encodeAtemPacket({
      flags: AtemPacketFlag.AckReply,
      sessionId: session.sessionId,
      acknowledgementNumber: sequence,
    })
    this.send(buffer, session)
  }

  private acknowledge(session: AtemSession, acknowledgement: number): void {
    for (const sequence of session.outbox.keys()) {
      if (isAcknowledged(sequence, acknowledgement)) {
        session.outbox.delete(sequence)
      }
    }
  }

  private acceptInboundSequence(session: AtemSession, sequence: number): InboundSequenceResult {
    if (sequence === nextAtemSequence(session.lastInboundSequence)) {
      session.lastInboundSequence = sequence
      return 'accepted'
    }
    return isSequenceAhead(sequence, session.lastInboundSequence) ? 'gap' : 'duplicate'
  }

  private resendFrom(session: AtemSession, firstSequence: number): void {
    const now = Date.now()
    if (now - session.lastInboundRetransmitAt < RETRANSMIT_REQUEST_INTERVAL_MS) {
      return
    }
    session.lastInboundRetransmitAt = now
    for (const [sequence, pending] of session.outbox) {
      if (sequence === firstSequence || isAcknowledged(firstSequence, sequence)) {
        if (pending.attempts >= MAX_RETRIES) {
          continue
        }
        pending.sentAt = now
        pending.attempts += 1
        this.send(pending.buffer, session)
      }
    }
  }

  private requestRetransmission(session: AtemSession): void {
    const now = Date.now()
    if (now - session.lastOutboundRetransmitAt < RETRANSMIT_REQUEST_INTERVAL_MS) {
      return
    }
    session.lastOutboundRetransmitAt = now
    this.send(
      encodeAtemPacket({
        flags: AtemPacketFlag.RetransmitRequest,
        sessionId: session.sessionId,
        retransmitFrom: nextAtemSequence(session.lastInboundSequence),
      }),
      session,
    )
  }

  private sweepSessions(): void {
    const now = Date.now()
    for (const [endpointKey, session] of this.sessions) {
      if (session.phase === 'awaiting-handshake-ack') {
        if (now - session.handshakeSentAt >= HANDSHAKE_RETRY_INTERVAL_MS) {
          if (session.handshakeAttempts >= MAX_HANDSHAKE_RETRIES) {
            this.dropSession(
              session,
              `ATEM UDP client ${session.address}:${session.port} did not acknowledge the session handshake.`,
            )
          } else {
            this.sendHandshake(session)
          }
        }
        continue
      }

      if (now - session.lastSeenAt > SESSION_TIMEOUT_MS) {
        this.dropSession(
          session,
          `ATEM UDP client disconnected from ${session.address}:${session.port}.`,
        )
        continue
      }

      for (const pending of session.outbox.values()) {
        if (now - pending.sentAt < RETRY_INTERVAL_MS) {
          continue
        }
        if (pending.attempts >= MAX_RETRIES) {
          this.dropSession(
            session,
            `ATEM UDP client ${session.address}:${session.port} stopped acknowledging packets.`,
          )
          break
        }
        pending.sentAt = now
        pending.attempts += 1
        this.send(pending.buffer, session)
      }

      if (
        this.sessions.has(endpointKey) &&
        session.phase === 'ready' &&
        session.outbox.size === 0 &&
        now - session.lastOutboundAt >= HEARTBEAT_MS
      ) {
        this.sendReliablePayload(session, new Uint8Array(0))
      }
    }
  }

  private send(buffer: Uint8Array, session: AtemSession): void {
    const socket = this.socket
    if (socket === undefined || this.status !== 'listening') {
      return
    }
    session.lastOutboundAt = Date.now()
    socket.send(buffer, session.port, session.address, (error) => {
      if (error !== null) {
        this.options.logger.debug(
          `Unable to send an ATEM UDP packet to ${session.address}:${session.port}: ${error.message}`,
        )
      }
    })
  }

  private sendHandshake(session: AtemSession): void {
    session.handshakeSentAt = Date.now()
    session.handshakeAttempts += 1
    this.send(session.handshakeResponse, session)
  }

  private dropSession(session: AtemSession, message: string): void {
    if (this.sessions.get(session.endpointKey) !== session) {
      return
    }
    const wasReady = session.phase === 'ready'
    this.sessions.delete(session.endpointKey)
    this.options.logger.warn(message)
    if (wasReady) {
      this.emitClientCount()
    }
  }

  private allocateSessionId(): number {
    let id = Math.floor(Math.random() * 0xffff) + 1
    const used = new Set([...this.sessions.values()].map((session) => session.sessionId))
    while (used.has(id)) {
      id = id === 0xffff ? 1 : id + 1
    }
    return id
  }

  private endpointKey(remote: RemoteInfo): string {
    return `${remote.family}:${remote.address}:${remote.port}`
  }

  private emitClientCount(): void {
    this.options.onClientCountChanged?.(this.getClientCount())
  }
}

function joinEncodedRecords(records: readonly Uint8Array[], length: number): Uint8Array {
  const payload = new Uint8Array(length)
  let offset = 0
  for (const record of records) {
    payload.set(record, offset)
    offset += record.byteLength
  }
  return payload
}

function isAcknowledged(sequence: number, acknowledgement: number): boolean {
  const distance = (acknowledgement - sequence + 0x8000) % 0x8000
  return distance < 0x4000
}

function isSequenceAhead(sequence: number, baseline: number): boolean {
  const distance = (sequence - baseline + 0x8000) % 0x8000
  return distance > 0 && distance < 0x4000
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
