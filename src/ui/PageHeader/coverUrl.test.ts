import { describe, expect, it } from 'vitest'
import { parseCoverUrl } from './coverUrl'

describe('parseCoverUrl', () => {
  it('accepts https and http links', () => {
    expect(parseCoverUrl('https://images.example.com/c182-cover.jpg')).toBe(
      'https://images.example.com/c182-cover.jpg',
    )
    expect(parseCoverUrl('http://localhost:5173/cover.png')).toBe('http://localhost:5173/cover.png')
  })

  it('trims whitespace around the link', () => {
    expect(parseCoverUrl('  https://example.com/a.jpg \n')).toBe('https://example.com/a.jpg')
  })

  it('assumes https when the scheme is missing', () => {
    expect(parseCoverUrl('example.com/desk.jpg')).toBe('https://example.com/desk.jpg')
  })

  it('rejects other schemes', () => {
    expect(parseCoverUrl('javascript:alert(1)')).toBeNull()
    expect(parseCoverUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(parseCoverUrl('file:///etc/passwd')).toBeNull()
    expect(parseCoverUrl('ftp://example.com/a.jpg')).toBeNull()
  })

  it('rejects empty text, spaces inside and single words', () => {
    expect(parseCoverUrl('')).toBeNull()
    expect(parseCoverUrl('   ')).toBeNull()
    expect(parseCoverUrl('my cover.jpg')).toBeNull()
    expect(parseCoverUrl('cover')).toBeNull()
  })
})
