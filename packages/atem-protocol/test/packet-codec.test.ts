import { describe, expect, it } from 'vitest'
import {
  ATEM_PACKET_HEADER_BYTES,
  ATEM_SEQUENCE_MAX,
  AtemPacketFlag,
  AtemProtocolCodecError,
  decodeAtemCommandRecord,
  decodeAtemCommandRecords,
  decodeAtemPacket,
  decodeAtemPacketHeader,
  encodeAtemCommandRecord,
  encodeAtemPacket,
  encodeAtemPacketHeader,
  hasAtemPacketFlag,
  nextAtemSequence,
  type AtemPacketHeader,
} from '../src/index.js'

function expectCodecError(action: () => unknown, code: AtemProtocolCodecError['code']): void {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }

  if (!(thrown instanceof AtemProtocolCodecError)) {
    throw new Error('Expected an AtemProtocolCodecError.')
  }
  expect(thrown.code).toBe(code)
}

describe('ATEM UDP packet codec', () => {
  it('encodes the documented big-endian header layout and decodes it losslessly', () => {
    const header: AtemPacketHeader = {
      flags: AtemPacketFlag.AckRequest | AtemPacketFlag.AckReply,
      length: ATEM_PACKET_HEADER_BYTES,
      sessionId: 0x1234,
      acknowledgementNumber: 0x0102,
      retransmitFrom: 0x0304,
      retransmitTo: 0x0506,
      packetSequence: 0x0708,
    }

    const bytes = encodeAtemPacketHeader(header)
    expect(bytes).toEqual(
      new Uint8Array([0x88, 0x0c, 0x12, 0x34, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
    )
    expect(decodeAtemPacketHeader(bytes)).toEqual(header)
  })

  it('round-trips a complete packet and derives its declared length from the payload', () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    const datagram = encodeAtemPacket(
      {
        flags: AtemPacketFlag.NewSession,
        sessionId: 0xabcd,
        acknowledgementNumber: 1,
        retransmitFrom: 2,
        retransmitTo: 3,
        packetSequence: 4,
      },
      payload,
    )

    expect(datagram.slice(0, 2)).toEqual(new Uint8Array([0x10, 0x10]))
    expect(decodeAtemPacket(datagram)).toEqual({
      header: {
        flags: AtemPacketFlag.NewSession,
        length: ATEM_PACKET_HEADER_BYTES + payload.byteLength,
        sessionId: 0xabcd,
        acknowledgementNumber: 1,
        retransmitFrom: 2,
        retransmitTo: 3,
        packetSequence: 4,
      },
      payload,
    })
  })

  it('exposes and combines the defined transport flags without conflating them with length bits', () => {
    const flags = AtemPacketFlag.AckRequest | AtemPacketFlag.RetransmitRequest
    const datagram = encodeAtemPacket({ flags, sessionId: 9 }, new Uint8Array([42]))
    const decoded = decodeAtemPacket(datagram)

    expect(decoded.header.flags).toBe(flags)
    expect(hasAtemPacketFlag(decoded.header.flags, AtemPacketFlag.AckRequest)).toBe(true)
    expect(hasAtemPacketFlag(decoded.header.flags, AtemPacketFlag.RetransmitRequest)).toBe(true)
    expect(hasAtemPacketFlag(decoded.header.flags, AtemPacketFlag.AckReply)).toBe(false)
  })

  it('accepts the highest 15-bit sequence and wraps it to zero', () => {
    const packet = encodeAtemPacket({ sessionId: 1, packetSequence: ATEM_SEQUENCE_MAX })
    expect(decodeAtemPacket(packet).header.packetSequence).toBe(ATEM_SEQUENCE_MAX)
    expect(nextAtemSequence(ATEM_SEQUENCE_MAX)).toBe(0)
    expect(nextAtemSequence(41)).toBe(42)
  })

  it('rejects sequence fields outside the protocol 15-bit range', () => {
    expectCodecError(
      () => encodeAtemPacket({ sessionId: 1, packetSequence: ATEM_SEQUENCE_MAX + 1 }),
      'invalid-sequence',
    )

    const datagram = new Uint8Array(ATEM_PACKET_HEADER_BYTES)
    datagram[1] = ATEM_PACKET_HEADER_BYTES
    datagram[10] = 0x80
    expectCodecError(() => decodeAtemPacket(datagram), 'invalid-sequence')
  })

  it('rejects truncated datagrams and declared lengths that do not match the received UDP payload', () => {
    expectCodecError(
      () => decodeAtemPacket(new Uint8Array(ATEM_PACKET_HEADER_BYTES - 1)),
      'packet-too-short',
    )

    const tooShort = new Uint8Array(ATEM_PACKET_HEADER_BYTES)
    tooShort[1] = ATEM_PACKET_HEADER_BYTES + 1
    expectCodecError(() => decodeAtemPacket(tooShort), 'packet-length-mismatch')

    const tooLong = new Uint8Array(ATEM_PACKET_HEADER_BYTES + 1)
    tooLong[1] = ATEM_PACKET_HEADER_BYTES
    expectCodecError(() => decodeAtemPacket(tooLong), 'packet-length-mismatch')
  })

  it('rejects packet headers whose encoded length cannot contain the header', () => {
    const malformed = new Uint8Array(ATEM_PACKET_HEADER_BYTES)
    malformed[1] = ATEM_PACKET_HEADER_BYTES - 1
    expectCodecError(() => decodeAtemPacketHeader(malformed), 'invalid-packet-length')
  })
})

describe('ATEM command record codec', () => {
  it('encodes the eight-byte record header and round-trips payload bytes', () => {
    const record = { command: 'PrgI', payload: new Uint8Array([0, 0, 0x0b, 0xc2]) }
    const bytes = encodeAtemCommandRecord(record)

    expect(bytes).toEqual(new Uint8Array([0, 12, 0, 0, 0x50, 0x72, 0x67, 0x49, 0, 0, 0x0b, 0xc2]))
    expect(decodeAtemCommandRecord(bytes)).toEqual({ record, bytesRead: 12 })
  })

  it('decodes a sequence of records, including an empty command payload', () => {
    const program = encodeAtemCommandRecord({
      command: 'PrgI',
      payload: new Uint8Array([0, 0, 0, 1]),
    })
    const cut = encodeAtemCommandRecord({ command: 'DCut', payload: new Uint8Array(0) })
    const payload = new Uint8Array(program.byteLength + cut.byteLength)
    payload.set(program)
    payload.set(cut, program.byteLength)

    expect(decodeAtemCommandRecords(payload)).toEqual([
      { command: 'PrgI', payload: new Uint8Array([0, 0, 0, 1]) },
      { command: 'DCut', payload: new Uint8Array(0) },
    ])
  })

  it('rejects a record shorter than its fixed header', () => {
    expectCodecError(
      () => decodeAtemCommandRecords(new Uint8Array([0, 7, 0, 0, 0, 0, 0, 0])),
      'invalid-record-length',
    )
  })

  it('rejects records that claim more bytes than are present', () => {
    expectCodecError(
      () => decodeAtemCommandRecords(new Uint8Array([0, 12, 0, 0, 0x44, 0x43, 0x75, 0x74])),
      'record-length-mismatch',
    )
  })

  it('rejects non-zero reserved bytes, trailing partial data, and non-ASCII command names', () => {
    expectCodecError(
      () => decodeAtemCommandRecords(new Uint8Array([0, 8, 1, 0, 0x44, 0x43, 0x75, 0x74])),
      'invalid-record-reserved-bytes',
    )
    expectCodecError(() => decodeAtemCommandRecords(new Uint8Array([0])), 'record-too-short')
    expectCodecError(
      () => encodeAtemCommandRecord({ command: 'bad\n', payload: new Uint8Array(0) }),
      'invalid-command-name',
    )
  })
})
