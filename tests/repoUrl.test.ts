import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../server/errors.ts';
import { parseRepoInput } from '../server/repoUrl.ts';

describe('parseRepoInput: accepted forms', () => {
  const cases: Array<[string, { owner: string; repo: string }]> = [
    ['https://github.com/facebook/react', { owner: 'facebook', repo: 'react' }],
    ['https://github.com/facebook/react/', { owner: 'facebook', repo: 'react' }],
    ['http://github.com/facebook/react', { owner: 'facebook', repo: 'react' }],
    ['https://www.github.com/facebook/react', { owner: 'facebook', repo: 'react' }],
    ['https://GitHub.com/facebook/react.git', { owner: 'facebook', repo: 'react' }],
    ['github.com/facebook/react', { owner: 'facebook', repo: 'react' }],
    ['facebook/react', { owner: 'facebook', repo: 'react' }],
    ['  octocat/Hello-World  ', { owner: 'octocat', repo: 'Hello-World' }],
    ['https://github.com/vercel/next.js', { owner: 'vercel', repo: 'next.js' }],
    ['https://github.com/a/b_c-d.e', { owner: 'a', repo: 'b_c-d.e' }],
    ['https://github.com/owner/repo?tab=readme#top', { owner: 'owner', repo: 'repo' }],
  ];
  for (const [input, expected] of cases) {
    it(`accepts ${JSON.stringify(input)}`, () => {
      assert.deepEqual(parseRepoInput(input), expected);
    });
  }
});

describe('parseRepoInput: rejected input', () => {
  const cases: Array<[string, unknown]> = [
    ['empty string', ''],
    ['whitespace only', '   '],
    ['non-string', 42],
    ['null', null],
    ['missing repository', 'https://github.com/facebook'],
    ['missing repository with slash', 'https://github.com/facebook/'],
    ['shorthand without repository', 'facebook/'],
    ['single word', 'react'],
    ['extra path segments', 'https://github.com/facebook/react/tree/main'],
    ['extra shorthand segments', 'facebook/react/issues'],
    ['issues path', 'https://github.com/facebook/react/issues/1'],
    ['gitlab host', 'https://gitlab.com/owner/repo'],
    ['lookalike suffix host', 'https://github.com.evil.com/owner/repo'],
    ['lookalike prefix host', 'https://evilgithub.com/owner/repo'],
    ['subdomain host', 'https://api.github.com/owner/repo'],
    ['credentials in URL', 'https://user:pass@github.com/owner/repo'],
    ['userinfo host trick', 'https://github.com@evil.com/owner/repo'],
    ['custom port', 'https://github.com:8443/owner/repo'],
    ['file scheme', 'file:///etc/passwd'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['ftp scheme', 'ftp://github.com/owner/repo'],
    ['ssh form', 'git@github.com:owner/repo.git'],
    ['internal address', 'http://127.0.0.1/owner/repo'],
    ['metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['path traversal', 'owner/..'],
    ['dot repository', 'owner/.'],
    ['encoded traversal', 'https://github.com/owner/%2e%2e'],
    ['space inside', 'owner/re po'],
    ['newline inside', 'owner/repo\nhttps://evil.com'],
    ['null byte', 'owner/re\u0000po'],
    ['backslash', 'owner\\repo'],
    ['owner with underscore', 'own_er/repo'],
    ['owner starting with hyphen', '-owner/repo'],
    ['owner too long', `${'a'.repeat(40)}/repo`],
    ['repo with unsupported characters', 'owner/re$po'],
    ['over-long input', `owner/${'a'.repeat(300)}`],
  ];
  for (const [name, input] of cases) {
    it(`rejects ${name}`, () => {
      assert.throws(
        () => parseRepoInput(input),
        (err: unknown) => err instanceof AppError && err.code === 'invalid_input' && err.status === 400,
      );
    });
  }
});
