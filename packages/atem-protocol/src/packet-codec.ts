/**
 * Binary framing for the ATEM UDP transport.
 *
 * This module intentionally stops at packet and record framing. It knows nothing
 * about sockets, sessions, or the meaning of individual command payloads.
 */

/** Every ATEM UDP datagram starts with this many bytes. */
export const ATEM_PACKET_HEADER_BYTES = 12

/** The lower eleven bits of the first header word contain the datagram length. */
export const ATEM_PACKET_LENGTH_MASK = 0x07ff

/** The largest complete ATEM datagram representable in its header. */
export const ATEM_PACKET_MAX_BYTES = ATEM_PACKET_LENGTH_MASK

/** ATEM packet sequence fields are unsigned 15-bit values. */
export const ATEM_SEQUENCE_MAX = 0x7fff

/** A command record has a two-byte length, two reserved bytes, and a four-byte name. */
export const ATEM_COMMAND_HEADER_BYTES = 8

/**
 * Packet flags are represented in their unshifted, semantic form. The encoder
 * places them in the top five bits of the first header word.
 */
export const AtemPacketFlag = {
  AckRequest: 0x01,
  NewSession: 0x02,
  Retransmit: 0x04,
  RetransmitRequest: 0x08,
  AckReply: 0x10,
} as const

export type AtemPacketFlagValue = (typeof AtemPacketFlag)[keyof typeof AtemPacketFlag]

export type AtemProtocolCodecErrorCode =
  | 'invalid-byte-array'
  | 'packet-too-short'
  | 'invalid-packet-length'
  | 'packet-length-mismatch'
  | 'invalid-header-field'
  | 'invalid-sequence'
  | 'record-too-short'
  | 'invalid-record-length'
  | 'record-length-mismatch'
  | 'invalid-record-reserved-bytes'
  | 'invalid-command-name'

/** A malformed or invalid value at the binary transport boundary. */
export class AtemProtocolCodecError extends Error {
  public constructor(
    public readonly code: AtemProtocolCodecErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AtemProtocolCodecError'
  }
}

/** The fully populated, on-the-wire ATEM UDP header. */
export interface AtemPacketHeader {
  /** Semantic flags, before their left shift into the first header word. */
  flags: number
  /** Complete datagram size, including this 12-byte header. */
  length: number
  sessionId: number
  acknowledgementNumber: number
  retransmitFrom: number
  /**
   * The second retransmit sequence field (bytes 8–9). It is zero for the
   * initial v1 server packets, but is retained so the codec does not discard it.
   */
  retransmitTo: number
  packetSequence: number
}

/** Header fields supplied when encoding a packet whose length is payload-derived. */
export interface AtemPacketHeaderFields {
  sessionId: number
  flags?: number
  acknowledgementNumber?: number
  retransmitFrom?: number
  retransmitTo?: number
  packetSequence?: number
}

export interface AtemPacket {
  header: AtemPacketHeader
  payload: Uint8Array
}

export interface AtemCommandRecord {
  /** Four printable ASCII bytes, such as `PrgI` or `CPvI`. */
  command: string
  payload: Uint8Array
}

/** A single record decoded from a byte range, useful for streaming record parsers. */
export interface DecodedAtemCommandRecord {
  record: AtemCommandRecord
  bytesRead: number
}

const EMPTY_BYTES = new Uint8Array(0)
const ATEM_PACKET_FLAG_MAX = 0x1f
const UINT16_MAX = 0xffff

/** Returns whether every bit in `flag` is present in a packet flag set. */
export function hasAtemPacketFlag(flags: number, flag: AtemPacketFlagValue): boolean {
  return (flags & flag) === flag
}

/** Advances a 15-bit ATEM sequence ID, wrapping immediately after 32767. */
export function nextAtemSequence(sequence: number): number {
  assertSequence('sequence', sequence)
  return sequence === ATEM_SEQUENCE_MAX ? 0 : sequence + 1
}

/** Encodes exactly the 12-byte ATEM UDP header. */
export function encodeAtemPacketHeader(header: AtemPacketHeader): Uint8Array {
  validateHeader(header)

  const bytes = new Uint8Array(ATEM_PACKET_HEADER_BYTES)
  writeUInt16(bytes, 0, (header.flags << 11) | header.length)
  writeUInt16(bytes, 2, header.sessionId)
  writeUInt16(bytes, 4, header.acknowledgementNumber)
  writeUInt16(bytes, 6, header.retransmitFrom)
  writeUInt16(bytes, 8, header.retransmitTo)
  writeUInt16(bytes, 10, header.packetSequence)
  return bytes
}

/**
 * Decodes the first 12 bytes of a datagram. Use {@link decodeAtemPacket} when
 * the declared datagram length should also be checked against the supplied data.
 */
export function decodeAtemPacketHeader(datagram: Uint8Array): AtemPacketHeader {
  assertByteArray('datagram', datagram)
  if (datagram.byteLength < ATEM_PACKET_HEADER_BYTES) {
    throw new AtemProtocolCodecError(
      'packet-too-short',
      `ATEM packet header requires ${ATEM_PACKET_HEADER_BYTES} bytes; received ${datagram.byteLength}.`,
    )
  }

  const flagsAndLength = readUInt16(datagram, 0)
  const header: AtemPacketHeader = {
    flags: flagsAndLength >>> 11,
    length: flagsAndLength & ATEM_PACKET_LENGTH_MASK,
    sessionId: readUInt16(datagram, 2),
    acknowledgementNumber: readUInt16(datagram, 4),
    retransmitFrom: readUInt16(datagram, 6),
    retransmitTo: readUInt16(datagram, 8),
    packetSequence: readUInt16(datagram, 10),
  }

  validateHeader(header)
  return header
}

/**
 * Encodes a complete UDP datagram. Its length field is always derived from the
 * supplied payload, avoiding an inconsistent header at the call site.
 */
export function encodeAtemPacket(
  fields: AtemPacketHeaderFields,
  payload: Uint8Array = EMPTY_BYTES,
): Uint8Array {
  assertByteArray('payload', payload)

  const header: AtemPacketHeader = {
    flags: fields.flags ?? 0,
    length: ATEM_PACKET_HEADER_BYTES + payload.byteLength,
    sessionId: fields.sessionId,
    acknowledgementNumber: fields.acknowledgementNumber ?? 0,
    retransmitFrom: fields.retransmitFrom ?? 0,
    retransmitTo: fields.retransmitTo ?? 0,
    packetSequence: fields.packetSequence ?? 0,
  }
  const bytes = new Uint8Array(header.length)
  bytes.set(encodeAtemPacketHeader(header))
  bytes.set(payload, ATEM_PACKET_HEADER_BYTES)
  return bytes
}

/** Decodes a complete, length-checked UDP datagram. */
export function decodeAtemPacket(datagram: Uint8Array): AtemPacket {
  const header = decodeAtemPacketHeader(datagram)
  if (datagram.byteLength !== header.length) {
    throw new AtemProtocolCodecError(
      'packet-length-mismatch',
      `ATEM packet declares ${header.length} bytes but received ${datagram.byteLength}.`,
    )
  }

  return {
    header,
    payload: datagram.slice(ATEM_PACKET_HEADER_BYTES),
  }
}

/** Encodes one ATEM command record, including its eight-byte record header. */
export function encodeAtemCommandRecord(record: AtemCommandRecord): Uint8Array {
  assertByteArray('record payload', record.payload)
  assertCommandName(record.command)

  const length = ATEM_COMMAND_HEADER_BYTES + record.payload.byteLength
  if (length > UINT16_MAX) {
    throw new AtemProtocolCodecError(
      'invalid-record-length',
      `ATEM command record is ${length} bytes; the maximum is ${UINT16_MAX}.`,
    )
  }

  const bytes = new Uint8Array(length)
  writeUInt16(bytes, 0, length)
  for (let index = 0; index < record.command.length; index += 1) {
    bytes[4 + index] = record.command.charCodeAt(index)
  }
  bytes.set(record.payload, ATEM_COMMAND_HEADER_BYTES)
  return bytes
}

/**
 * Decodes one command record from `bytes`, starting at `offset`. Extra bytes
 * after the record are deliberately left for the caller to process.
 */
export function decodeAtemCommandRecord(bytes: Uint8Array, offset = 0): DecodedAtemCommandRecord {
  assertByteArray('record bytes', bytes)
  assertOffset(offset, bytes.byteLength)

  const remaining = bytes.byteLength - offset
  if (remaining < 2) {
    throw new AtemProtocolCodecError(
      'record-too-short',
      `ATEM command record needs a two-byte length; only ${remaining} byte(s) remain.`,
    )
  }

  const length = readUInt16(bytes, offset)
  if (length < ATEM_COMMAND_HEADER_BYTES) {
    throw new AtemProtocolCodecError(
      'invalid-record-length',
      `ATEM command record length ${length} is below the ${ATEM_COMMAND_HEADER_BYTES}-byte header size.`,
    )
  }
  if (length > remaining) {
    throw new AtemProtocolCodecError(
      'record-length-mismatch',
      `ATEM command record declares ${length} bytes but only ${remaining} remain.`,
    )
  }
  if (bytes[offset + 2] !== 0 || bytes[offset + 3] !== 0) {
    throw new AtemProtocolCodecError(
      'invalid-record-reserved-bytes',
      'ATEM command record bytes 2 and 3 must be zero.',
    )
  }

  const command = String.fromCharCode(
    bytes[offset + 4]!,
    bytes[offset + 5]!,
    bytes[offset + 6]!,
    bytes[offset + 7]!,
  )
  assertCommandName(command)

  return {
    record: {
      command,
      payload: bytes.slice(offset + ATEM_COMMAND_HEADER_BYTES, offset + length),
    },
    bytesRead: length,
  }
}

/** Decodes every complete command record in a UDP payload. */
export function decodeAtemCommandRecords(payload: Uint8Array): AtemCommandRecord[] {
  assertByteArray('payload', payload)

  const records: AtemCommandRecord[] = []
  let offset = 0
  while (offset < payload.byteLength) {
    const decoded = decodeAtemCommandRecord(payload, offset)
    records.push(decoded.record)
    offset += decoded.bytesRead
  }
  return records
}

function validateHeader(header: AtemPacketHeader): void {
  assertUnsignedInteger('flags', header.flags, ATEM_PACKET_FLAG_MAX, 'invalid-header-field')
  assertUnsignedInteger('length', header.length, ATEM_PACKET_MAX_BYTES, 'invalid-packet-length')
  if (header.length < ATEM_PACKET_HEADER_BYTES) {
    throw new AtemProtocolCodecError(
      'invalid-packet-length',
      `ATEM packet length ${header.length} is below the ${ATEM_PACKET_HEADER_BYTES}-byte header size.`,
    )
  }
  assertUnsignedInteger('sessionId', header.sessionId, UINT16_MAX, 'invalid-header-field')
  assertSequence('acknowledgementNumber', header.acknowledgementNumber)
  assertSequence('retransmitFrom', header.retransmitFrom)
  assertSequence('retransmitTo', header.retransmitTo)
  assertSequence('packetSequence', header.packetSequence)
}

function assertSequence(field: string, value: number): void {
  assertUnsignedInteger(field, value, ATEM_SEQUENCE_MAX, 'invalid-sequence')
}

function assertUnsignedInteger(
  field: string,
  value: number,
  maximum: number,
  code: 'invalid-header-field' | 'invalid-packet-length' | 'invalid-sequence',
): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new AtemProtocolCodecError(
      code,
      `${field} must be an unsigned integer between 0 and ${maximum}; received ${String(value)}.`,
    )
  }
}

function assertByteArray(field: string, value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new AtemProtocolCodecError('invalid-byte-array', `${field} must be a Uint8Array.`)
  }
}

function assertCommandName(command: string): void {
  if (command.length !== 4) {
    throw new AtemProtocolCodecError(
      'invalid-command-name',
      `ATEM command names must be exactly four ASCII bytes; received ${command.length} UTF-16 code unit(s).`,
    )
  }

  for (let index = 0; index < command.length; index += 1) {
    const codePoint = command.charCodeAt(index)
    if (codePoint < 0x20 || codePoint > 0x7e) {
      throw new AtemProtocolCodecError(
        'invalid-command-name',
        'ATEM command names must contain only printable ASCII bytes.',
      )
    }
  }
}

function assertOffset(offset: number, length: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset >= length) {
    throw new AtemProtocolCodecError(
      'record-too-short',
      `ATEM command record offset must identify a byte in the buffer; received ${String(offset)} for ${length} bytes.`,
    )
  }
}

function readUInt16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function writeUInt16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 8
  bytes[offset + 1] = value & 0xff
}
