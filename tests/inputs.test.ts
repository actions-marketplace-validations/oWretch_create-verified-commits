import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'

vi.mock('@actions/core')

// Import after mock so the module gets the mocked version
const { parseInputs } = await import('../src/inputs')

function mockInputs(inputs: Record<string, string>, failOnEmpty = true): void {
  vi.mocked(core.getInput).mockImplementation((name: string) => inputs[name] ?? '')
  vi.mocked(core.getBooleanInput).mockReturnValue(failOnEmpty)
}

describe('parseInputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all inputs on happy path', () => {
    mockInputs({
      token: 'ghp_test',
      'commit-message': 'feat: add feature\n\nThis is the body.',
      ref: 'refs/heads/main',
      files: 'src/**\ntests/**',
      'tag-name': 'v1.0.0',
      'tag-message': 'Release v1.0.0',
    })

    const result = parseInputs()

    expect(result.token).toBe('ghp_test')
    expect(result.message.headline).toBe('feat: add feature')
    expect(result.message.body).toBe('This is the body.')
    expect(result.refOverride).toBe('refs/heads/main')
    expect(result.filePatterns).toEqual(['src/**', 'tests/**'])
    expect(result.tagName).toBe('v1.0.0')
    expect(result.tagMessage).toBe('Release v1.0.0')
    expect(result.failOnEmpty).toBe(true)
  })

  it('returns minimal inputs with only required fields', () => {
    mockInputs({ token: 'ghp_test', 'commit-message': 'fix: bug' })

    const result = parseInputs()

    expect(result.token).toBe('ghp_test')
    expect(result.message.headline).toBe('fix: bug')
    expect(result.message.body).toBeUndefined()
    expect(result.refOverride).toBe('')
    expect(result.filePatterns).toEqual([])
    expect(result.tagName).toBeUndefined()
    expect(result.tagMessage).toBeUndefined()
  })

  describe('commit message parsing', () => {
    it('parses single-line message', () => {
      mockInputs({ token: 'ghp_test', 'commit-message': 'chore: update deps' })
      const { message } = parseInputs()
      expect(message.headline).toBe('chore: update deps')
      expect(message.body).toBeUndefined()
    })

    it('parses multi-line message with body', () => {
      mockInputs({
        token: 'ghp_test',
        'commit-message': 'feat: new thing\n\nThis explains the change.\nMore detail here.',
      })
      const { message } = parseInputs()
      expect(message.headline).toBe('feat: new thing')
      expect(message.body).toBe('This explains the change.\nMore detail here.')
    })

    it('preserves blank lines in the middle of the body', () => {
      mockInputs({
        token: 'ghp_test',
        'commit-message': 'feat: title\n\nbody line 1\n\nbody line 2',
      })
      const { message } = parseInputs()
      expect(message.headline).toBe('feat: title')
      expect(message.body).toBe('body line 1\n\nbody line 2')
    })

    it('trims leading and trailing blank lines from body', () => {
      mockInputs({
        token: 'ghp_test',
        'commit-message': 'feat: title\n\n\nbody line\n\n',
      })
      const { message } = parseInputs()
      expect(message.headline).toBe('feat: title')
      expect(message.body).toBe('body line')
    })

    it('throws when commit-message is whitespace-only', () => {
      vi.mocked(core.getInput).mockImplementation((name: string) => {
        if (name === 'token') return 'ghp_test'
        if (name === 'commit-message') return '   \n  '
        return ''
      })
      vi.mocked(core.getBooleanInput).mockReturnValue(true)
      expect(() => parseInputs()).toThrow('commit-message must not be empty')
    })

    it('throws when commit-message is empty string', () => {
      vi.mocked(core.getInput).mockImplementation((name: string) => {
        if (name === 'token') return 'ghp_test'
        if (name === 'commit-message') return ''
        return ''
      })
      vi.mocked(core.getBooleanInput).mockReturnValue(true)
      // @actions/core throws for required:true when empty, but we also handle it
      vi.mocked(core.getInput).mockImplementation((name: string, _opts?: object) => {
        if (name === 'token') return 'ghp_test'
        return ''
      })
      expect(() => parseInputs()).toThrow()
    })
  })

  describe('file pattern parsing', () => {
    it('returns empty array when files input is empty', () => {
      mockInputs({ token: 'ghp_test', 'commit-message': 'fix: x', files: '' })
      expect(parseInputs().filePatterns).toEqual([])
    })

    it('returns single pattern', () => {
      mockInputs({ token: 'ghp_test', 'commit-message': 'fix: x', files: 'src/**' })
      expect(parseInputs().filePatterns).toEqual(['src/**'])
    })

    it('returns multiple patterns from multi-line input', () => {
      mockInputs({
        token: 'ghp_test',
        'commit-message': 'fix: x',
        files: 'src/**\ntests/**\ndocs/**',
      })
      expect(parseInputs().filePatterns).toEqual(['src/**', 'tests/**', 'docs/**'])
    })

    it('trims whitespace from patterns and filters blanks', () => {
      mockInputs({
        token: 'ghp_test',
        'commit-message': 'fix: x',
        files: '  src/**  \n\n  tests/**  \n',
      })
      expect(parseInputs().filePatterns).toEqual(['src/**', 'tests/**'])
    })
  })

  describe('fail-on-empty', () => {
    it('returns true when fail-on-empty is true', () => {
      mockInputs({ token: 'ghp_test', 'commit-message': 'fix: x' }, true)
      expect(parseInputs().failOnEmpty).toBe(true)
    })

    it('returns false when fail-on-empty is false', () => {
      mockInputs({ token: 'ghp_test', 'commit-message': 'fix: x' }, false)
      expect(parseInputs().failOnEmpty).toBe(false)
    })
  })

  describe('optional string inputs become undefined when empty', () => {
    it('tagName is undefined when empty', () => {
      mockInputs({ token: 'ghp_test', 'commit-message': 'fix: x', 'tag-name': '' })
      expect(parseInputs().tagName).toBeUndefined()
    })

    it('tagMessage is undefined when empty', () => {
      mockInputs({ token: 'ghp_test', 'commit-message': 'fix: x', 'tag-message': '' })
      expect(parseInputs().tagMessage).toBeUndefined()
    })

    it('tagName is set when non-empty', () => {
      mockInputs({ token: 'ghp_test', 'commit-message': 'fix: x', 'tag-name': 'v2.0.0' })
      expect(parseInputs().tagName).toBe('v2.0.0')
    })
  })

  describe('token validation', () => {
    it('throws when token is missing', () => {
      vi.mocked(core.getInput).mockImplementation((name: string, opts?: { required?: boolean }) => {
        if (name === 'token' && opts?.required)
          throw new Error('Input required and not supplied: token')
        return ''
      })
      vi.mocked(core.getBooleanInput).mockReturnValue(true)
      expect(() => parseInputs()).toThrow('Input required and not supplied: token')
    })
  })
})
