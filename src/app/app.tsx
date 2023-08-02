// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useEffect } from 'react'
import { loadIffImage } from '../iff'

// const testFile = './island.iff'
const testFile = './newtut-ham.iff'

type FormatID = 'ILBM' | 'PBM '
type ChunkID = 'BMHD' | 'CMAP' | 'SPRT' | 'BODY' | 'CCRT' | 'CRNG' | 'CAMG'

const MaskTypes = {
  NONE: 0,
  MASKED: 1,
  TRANSPARENT: 2,
  // Mac
  LASSO: 3
}

/* Non-standard Colour range chunk used by DPaint */
interface CRNG_Chunk {
  // INT16BE	padding	0x0000
  // INT16BE	rate	Colour cycle rate. The units are such that a rate of 60 steps per second is represented as 214 = 16384. Lower rates can be obtained by linear scaling: for 30 steps/second, rate = 8192.
  // INT16BE	flags	Flags which control the cycling of colours through the palette. If bit0 is 1, the colours should cycle, otherwise this colour register range is inactive and should have no effect. If bit1 is 0, the colours cycle upwards, i.e. each colour moves into the next index position in the colour map and the uppermost colour in the range moves down to the lowest position. If bit1 is 1, the colours cycle in the opposite direction. Only those colours between the low and high entries in the colour map should cycle.
  // UINT8	low	The index of the first entry in the colour map that is part of this range.
  // UINT8	high	The index of the last entry in the colour map that is part of this range.
  rate: number
  active: boolean
  reverse: boolean
  // lower and upper colour indexes of the range
  upper: number
  lower: number
}

interface BODY_Chunk {
  ID: ChunkID,
  pixelData: Uint8ClampedArray | null
}

interface CMAP_Chunk {
  ID: ChunkID,
  palette: Uint8ClampedArray
}

interface CAMG_Chunk {
  ID: ChunkID
  ham: boolean
  ehb: boolean
}

interface BMHD_Chunk {
    ID: ChunkID
    // UWORD w, h; /* raster width & height in pixels */
    w: number
    h: number
    // WORD x, y; /* pixel position for this image */
    x: number
    y: number
    // UBYTE nPlanes; /* # source bitplanes */
    nPlanes: number
    // Masking masking;
    mask: typeof MaskTypes[keyof typeof MaskTypes]
    // Compression compression;
    // 0: uncompressed
    // 1: RLE
    // 2: Vertical RLE (Atari)
    compression: number
    // UBYTE pad1; /* unused; ignore on read, write as 0 */
    pad1: number
    // UWORD transparentColor; /* transparent "color number" (sort of) */
    transparentColor: number
    // UBYTE xAspect, yAspect; /* pixel aspect, a ratio width : height */
    xAspect: number
    yAspect: number
    // WORD pageWidth, pageHeight;
    pageWidth: number
    pageHeight: number
    // pitch rowsize in bytes: not part of bmhd_chunk
    pitch: number
}

type Chunk = BMHD_Chunk | CMAP_Chunk | BODY_Chunk | CRNG_Chunk

interface IFFHeader {
  formatID: FormatID
  length: number
}

class Buffer {
  offset: number
  view: DataView
  buffer: ArrayBuffer
  length: number

  constructor(buffer: ArrayBuffer) {
    this.offset = 0
    this.view = new DataView(buffer)
    this.buffer = buffer
    this.length = buffer.byteLength
  }

  readInt8() {
    this.offset++
    return this.view.getInt8(this.offset -1)
  }

  readUint8() {
    this.offset++
    return this.view.getUint8(this.offset -1)
  }

  readUint16() {
    this.offset += 2
    return this.view.getUint16(this.offset -2)
  }

  readInt16() {
    this.offset += 2
    return this.view.getInt16(this.offset -2)
  }

  readUint32() {
    this.offset += 4
    return this.view.getUint32(this.offset -4)
  }

  readInt32() {
    this.offset += 4
    return this.view.getInt16(this.offset -4)
  }

  readAsciiString(length: number) {
    this.offset += length
    const view = new DataView(this.buffer, this.offset - length, length)
    const decoder = new TextDecoder('utf-8')

    return decoder.decode(view)
  }

  getSubView(offset = this.offset) {
    return new DataView(this.buffer, offset)
  }
}

class IFF_Decoder {
  header?: IFFHeader
  chunks: Chunk[] = []
  buffer: Buffer
  ham = false
  ehb = false

  constructor(buffer: ArrayBuffer) {
    this.buffer = new Buffer(buffer)
    
    if (this.isForm()) {
      this.header = this.parseIFFHeader()
      this.decodeChunks()
      console.log('Header', this.header)
    }
  }

  isForm() {
    return this.buffer.length > 12 && this.buffer.readAsciiString(4) === 'FORM'
  }

  parseIFFHeader() {
    return {
      length: this.buffer.readUint32(),
      formatID: this.buffer.readAsciiString(4) as FormatID
    }
  }

  getBMHD() {
    return this.chunks.find(({ ID }) => ID === 'BMHD') as BMHD_Chunk
  }

  uncompressRLE(buffer: DataView, length: number) {
    const bmhd = this.getBMHD()

    if (bmhd) {
      const { h, nPlanes, pitch } = bmhd
      const pixelData = new Uint8ClampedArray(pitch * h * nPlanes)
      let index = 0

      let readBytes = 0
      while (readBytes < length) {
        const byte = buffer.getInt8(readBytes++)
        if (byte >= -127 && byte <= -1) {
          // read next byte
          const nextByte = buffer.getUint8(readBytes++)
          for (let i = 0; i <-byte + 1; ++i) {
            pixelData[index++] = nextByte
          }
        } else if (byte >= 0 && byte <= 127) {
          for (let i = 0; i < byte + 1; ++i) {
            pixelData[index] = buffer.getUint8(readBytes)
            readBytes++
            index++
          }
        } else {
          debugger
        }
      }

      return pixelData
    }

    return null
  }

  decodeChunks() {
    // or marker?
    while (this.buffer.offset < this.buffer.length) {
      const chunkID = this.buffer.readAsciiString(4)
      const chunkLength = this.buffer.readUint32()

      switch(chunkID) {
        case 'BMHD':
          console.log('decoding BMHD Chunk...')
          this.chunks.push(this.decodeBMHDChunk())
          break

        case 'CMAP':
          console.log('decoding CMAP Chunk...', chunkLength)
          this.chunks.push(this.decodeCMAPChunk(chunkLength))
          break

        case 'CAMG':
          console.log('decoding CAMG Chunk...', chunkLength)
          this.chunks.push(this.decodeCAMGChunk())
          break

        case 'BODY':
          console.log('decoding BODY chunk...', chunkLength)
          this.chunks.push(this.decodeBODYChunk(chunkLength))
          this.buffer.offset += chunkLength
          break

        case 'CRNG':
          console.log('decoding CRNG chunk...', chunkLength)
          this.chunks.push(this.decodeCRNGChunk(chunkLength))
          break

        default:
          this.buffer.offset += chunkLength
          console.warn(`chunk not supported: "${chunkID}"`)
      }
      // add pad byte if needed
      if (chunkLength % 2) {
        this.buffer.offset++
      }
    }
  }

  /** Convert interleaved Amiga planar to chunky pixel indexes */
  planarToChunky(bitplanes: Uint8ClampedArray | null, bmhd: BMHD_Chunk) {
    const { pitch, w, h, nPlanes } = bmhd
    const chunky = new Uint8ClampedArray(w * h)
    
    console.log('planes', nPlanes)

    if (!bitplanes) {
      return null
    }

    for (let y = 0; y < h; y++) {
      for (let p = 0; p < nPlanes; p++) {
	      const planeMask = 1 << p
        for (let i = 0; i < pitch; i++) {
          const offset = (pitch * nPlanes * y) + (p * pitch) + i
          const bit = bitplanes[offset]
        
          for (let b = 0; b < 8; b++) {
            const mask = 1 << (7 - b)
              // get current plane
              if (bit & mask) {
                const x = (i * 8) + b
                chunky[(y * w) + x] |= planeMask
              }
            }
          }
        }
      }
      
      return chunky
    }

  displayImage(pixelData: Uint8ClampedArray, bmhd: BMHD_Chunk) {
    const { nPlanes } = bmhd
    const { palette } = this.chunks.find(({ ID }) => ID === 'CMAP') as CMAP_Chunk
    const { w, h } = this.chunks.find(({ ID }) => ID === 'BMHD') as BMHD_Chunk
    const imageData = new ImageData(w, h)
    const data = imageData.data
    const numColors = palette.byteLength / 4

    for (let j = 0; j < h; ++j) {
      let previousRGBA = [0, 0, 0, 255]
      for (let i = 0; i < w; ++i) {
        const color = pixelData[((j * w) + i)]
        const paletteIndex = color * 4
        const idx = ((j * w) + i) * 4
        if (color < numColors) {
          data[idx] = palette[paletteIndex]
          data[idx + 1] = palette[paletteIndex + 1]
          data[idx + 2] = palette[paletteIndex + 2]
          data[idx + 3] = palette[paletteIndex + 3]
        } else {
          const control = (color & 0x30) >> 4
          data[idx] = previousRGBA[0]
          data[idx + 1] = previousRGBA[1]
          data[idx + 2] = previousRGBA[2]
          data[idx + 3] = previousRGBA[3]
          const val = color % numColors
          if (control === 1) {
            // TODO: correctly pad to 8 bits
            data[idx + 2] = val << 4
          } else if (control === 2) {
            data[idx] = val << 4            
          } else {
            data[idx + 1] = val << 4
          }
        }
        previousRGBA = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]]
      }
    }

    const canvas = document.getElementById('toto') as HTMLCanvasElement
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    console.log(ctx)
    ctx.putImageData(imageData, 0, 0)
  }

  extendEHBPalette() {
    const chunk = this.chunks.find(({ ID }) => ID === 'CMAP') as CMAP_Chunk
    const palette = chunk.palette
    // Some files have the EHB bit set but already contain a 64 colours palette
    // probably for upward compatibility: in this case we don't have to extend
    // the palette.
    // Files created before (eg. DPaint <= 4) only have a 32 colours CMAP.
    if (palette.byteLength > 32 * 4) {
      console.log('ehb is set but palette is already > 32 colours')
      return
    }
    const extendedPalette = new Uint8ClampedArray(palette.byteLength * 2)
    // copy current palette
    for (let i = 0; i < palette.byteLength; ++ i) {
      extendedPalette[i] = palette[i]
    }
    // extend palette
    for (let i = palette.byteLength, j=0; i < extendedPalette.byteLength; i+=4, j+=4) {
      extendedPalette[i] = palette[j] >> 1
      extendedPalette[i + 1] = palette[j + 1] >> 1
      extendedPalette[i + 2] = palette[j + 2] >> 1
      extendedPalette[i + 3] = 255
    }

    chunk.palette = extendedPalette
  }

  reduceHAMPalette() {
    const cmap = this.chunks.find(({ ID }) => ID === 'CMAP') as CMAP_Chunk
    const palette = cmap.palette
    const { nPlanes } = this.getBMHD()

    let bits = 0
    const numColors = palette.byteLength / 4
    while (2**bits <= numColors)
      bits++;

    if (bits > nPlanes) {
      bits -= (bits - nPlanes) + 2
      const length = numColors >> bits
      cmap.palette = cmap.palette.slice(0, 4 * length)
    }
  }

  decodeCAMGChunk() {
    const mode = this.buffer.readUint32()
    this.ham = !!(mode & 0x800)
    this.ehb = !!(mode & 0x80)

    // Enlarge the palette with 32 darker colors
    if (this.ehb) {
      this.extendEHBPalette()
    } else if (this.ham) {
      this.reduceHAMPalette()
    }

    return {
      ID: 'CAMG',
      ham: this.ham,
      ehb: this.ehb
    } as CAMG_Chunk
  }

  decodeCRNGChunk(length: number) {
    // reserved
    this.buffer.readUint16()
    const rate = this.buffer.readUint16()
    const flags = this.buffer.readUint16()
    const lower = this.buffer.readUint8()
    const upper = this.buffer.readUint8()

    return {
      ID: 'CRNG',
      rate,
      active: !!(rate && (flags & 1)),
      reverse: !!(flags & 2),
      lower,
      upper
    } as CRNG_Chunk
  }

  decodeBODYChunk(length: number) {
    const bmhd = this.chunks.find(({ ID }) => ID === 'BMHD') as BMHD_Chunk
    let pixelData: Uint8ClampedArray = null

    console.log('my row_bytes', bmhd.pitch)
    if (bmhd) {
      const { compression } = bmhd
      // RLE
      const planes = compression === 1 ?
      this.uncompressRLE(this.buffer.getSubView(), length)
      :
      new Uint8ClampedArray(this.buffer.buffer, this.buffer.offset, length)

      console.log('my iff bitplanes', planes)
      pixelData = this.planarToChunky(planes, bmhd)

      console.log('my pixel_buffer', pixelData)
      this.displayImage(pixelData!, bmhd)
    }

    return {
      ID: 'BODY',
      pixelData,
    } as BODY_ChunkODY_Chunk
    }

  decodeCMAPChunk(length: number) {
    // could be less that number of planes
    const numColors = length / 3
    // RGB+A per color
    const palette = new Uint8ClampedArray(numColors * 4)
    const max = numColors * 4

    for (let i = 0; i < max; i += 4) {
      palette[i] = this.buffer.readUint8()
      palette[i + 1] = this.buffer.readUint8()
      palette[i + 2] = this.buffer.readUint8()
      palette[i + 3] = 255
    }

    return {
      ID: 'CMAP',
      palette
    } as CMAP_Chunk
  }

  decodeBMHDChunk() {
      const buffer = this.buffer
      // parse header
      const header = {
        ID: 'BMHD',
        w: buffer.readUint16(),
        h: buffer.readUint16(),
        x: buffer.readInt16(),
        y: buffer.readInt16(),
        nPlanes: buffer.readUint8(),
        mask: buffer.readUint8(),
        compression: buffer.readUint8(),
        pad1: buffer.readUint8(),
        transparentColor: buffer.readUint16(),
        xAspect: buffer.readUint8(),
        yAspect: buffer.readUint8(),
        pageWidth: buffer.readInt16(),
        pageHeight: buffer.readInt16(),
    }

    return {
      ...header,
      pitch: Math.ceil(header.w / 16) * 2
    } as BMHD_Chunk
  }
}

async function loadImage() {
  try {
    const res = await fetch(testFile)
    const buffer = await res.arrayBuffer()
    const ilbm = new IFF_Decoder(buffer)
    console.log('chunks found', ilbm.chunks)
  } catch(e) {
    console.log('oops', e)
  }
}

export function App() {
  useEffect(() => {
    loadImage()
    loadIffImage(testFile, 'toto2', true)
  }, [])
  return (
    <div>
      <canvas id="toto" width="320" height="200" style={{border: '1px solid black'}}/> <br />
      <canvas id="toto2" width="320" height="200" style={{border: '1px solid black'}}/> <br />
    </div>
  );
}

export default App;
