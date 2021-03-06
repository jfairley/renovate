import nock from 'nock';
import * as httpMock from '../../../test/httpMock';
import {
  REPOSITORY_CHANGED,
  REPOSITORY_DISABLED,
  REPOSITORY_NOT_FOUND,
} from '../../constants/error-messages';
import { PR_STATE_CLOSED, PR_STATE_OPEN } from '../../constants/pull-requests';
import { BranchStatus } from '../../types';
import * as _git from '../../util/git';
import { Platform } from '../common';

function repoMock(
  endpoint: URL | string,
  projectKey: string,
  repositorySlug: string
) {
  const projectKeyLower = projectKey.toLowerCase();
  return {
    slug: repositorySlug,
    id: 13076,
    name: repositorySlug,
    scmId: 'git',
    state: 'AVAILABLE',
    statusMessage: 'Available',
    forkable: true,
    project: {
      key: projectKey,
      id: 2900,
      name: `${repositorySlug}'s name`,
      public: false,
      type: 'NORMAL',
      links: {
        self: [
          { href: `https://stash.renovatebot.com/projects/${projectKey}` },
        ],
      },
    },
    public: false,
    links: {
      clone: [
        {
          href: `${endpoint}/scm/${projectKeyLower}/${repositorySlug}.git`,
          name: 'http',
        },
        {
          href: `ssh://git@stash.renovatebot.com:7999/${projectKeyLower}/${repositorySlug}.git`,
          name: 'ssh',
        },
      ],
      self: [
        {
          href: `${endpoint}/projects/${projectKey}/repos/${repositorySlug}/browse`,
        },
      ],
    },
  };
}

function prMock(endpoint, projectKey, repositorySlug) {
  return {
    id: 5,
    version: 1,
    title: 'title',
    description: '* Line 1\r\n* Line 2',
    state: 'OPEN',
    open: true,
    closed: false,
    createdDate: 1547853840016,
    updatedDate: 1547853840016,
    fromRef: {
      id: 'refs/heads/userName1/pullRequest5',
      displayId: 'userName1/pullRequest5',
      latestCommit: '55efc02b2ab13a43a66cf705f5faacfcc6a762b4',
      // Removed this with the idea it's not needed
      // repository: {},
    },
    toRef: {
      id: 'refs/heads/master',
      displayId: 'master',
      latestCommit: '0d9c7726c3d628b7e28af234595cfd20febdbf8e',
      // Removed this with the idea it's not needed
      // repository: {},
    },
    locked: false,
    author: {
      user: {
        name: 'userName1',
        emailAddress: 'userName1@renovatebot.com',
        id: 144846,
        displayName: 'Renovate Bot',
        active: true,
        slug: 'userName1',
        type: 'NORMAL',
        links: {
          self: [{ href: `${endpoint}/users/userName1` }],
        },
      },
      role: 'AUTHOR',
      approved: false,
      status: 'UNAPPROVED',
    },
    reviewers: [
      {
        user: {
          name: 'userName2',
          emailAddress: 'userName2@renovatebot.com',
          id: 71155,
          displayName: 'Renovate bot 2',
          active: true,
          slug: 'userName2',
          type: 'NORMAL',
          links: {
            self: [{ href: `${endpoint}/users/userName2` }],
          },
        },
        role: 'REVIEWER',
        approved: false,
        status: 'UNAPPROVED',
      },
    ],
    participants: [],
    links: {
      self: [
        {
          href: `${endpoint}/projects/${projectKey}/repos/${repositorySlug}/pull-requests/5`,
        },
      ],
    },
  };
}

const scenarios = {
  'endpoint with no path': new URL('https://stash.renovatebot.com'),
  'endpoint with path': new URL('https://stash.renovatebot.com/vcs'),
};

describe('platform/bitbucket-server', () => {
  Object.entries(scenarios).forEach(([scenarioName, url]) => {
    const urlHost = url.origin;
    const urlPath = url.pathname === '/' ? '' : url.pathname;

    describe(scenarioName, () => {
      let bitbucket: Platform;
      let hostRules: jest.Mocked<typeof import('../../util/host-rules')>;
      let git: jest.Mocked<typeof _git>;

      async function initRepo(config = {}): Promise<nock.Scope> {
        const scope = httpMock
          .scope(urlHost)
          .get(`${urlPath}/rest/api/1.0/projects/SOME/repos/repo`)
          .reply(200, repoMock(url, 'SOME', 'repo'))
          .get(
            `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/branches/default`
          )
          .reply(200, {
            displayId: 'master',
          });
        await bitbucket.initRepo({
          endpoint: 'https://stash.renovatebot.com/vcs/',
          repository: 'SOME/repo',
          localDir: '',
          optimizeForDisabled: false,
          ...config,
        });
        return scope;
      }

      beforeEach(async () => {
        // reset module
        jest.resetModules();
        httpMock.reset();
        httpMock.setup();
        jest.mock('delay');
        jest.mock('../../util/git');
        jest.mock('../../util/host-rules');
        hostRules = require('../../util/host-rules');
        bitbucket = await import('.');
        git = require('../../util/git');
        git.branchExists.mockResolvedValue(true);
        git.isBranchStale.mockResolvedValue(false);
        git.getBranchCommit.mockResolvedValue(
          '0d9c7726c3d628b7e28af234595cfd20febdbf8e'
        );
        const endpoint =
          scenarioName === 'endpoint with path'
            ? 'https://stash.renovatebot.com/vcs/'
            : 'https://stash.renovatebot.com';
        hostRules.find.mockReturnValue({
          username: 'abc',
          password: '123',
        });
        await bitbucket.initPlatform({
          endpoint,
          username: 'abc',
          password: '123',
        });
      });

      describe('initPlatform()', () => {
        it('should throw if no endpoint', () => {
          expect.assertions(1);
          expect(() => bitbucket.initPlatform({})).toThrow();
        });
        it('should throw if no username/password', () => {
          expect.assertions(1);
          expect(() =>
            bitbucket.initPlatform({ endpoint: 'endpoint' })
          ).toThrow();
        });
        it('should init', async () => {
          expect(
            await bitbucket.initPlatform({
              endpoint: 'https://stash.renovatebot.com',
              username: 'abc',
              password: '123',
            })
          ).toMatchSnapshot();
        });
      });

      describe('getRepos()', () => {
        it('returns repos', async () => {
          expect.assertions(2);
          httpMock
            .scope(urlHost)
            .get(
              `${urlPath}/rest/api/1.0/repos?permission=REPO_WRITE&state=AVAILABLE&limit=100`
            )
            .reply(200, {
              size: 1,
              limit: 100,
              isLastPage: true,
              values: [repoMock(url, 'SOME', 'repo')],
              start: 0,
            });
          expect(await bitbucket.getRepos()).toEqual(['some/repo']);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('initRepo()', () => {
        it('works', async () => {
          expect.assertions(2);
          httpMock
            .scope(urlHost)
            .get(`${urlPath}/rest/api/1.0/projects/SOME/repos/repo`)
            .reply(200, repoMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/branches/default`
            )
            .reply(200, {
              displayId: 'master',
            });
          expect(
            await bitbucket.initRepo({
              endpoint: 'https://stash.renovatebot.com/vcs/',
              repository: 'SOME/repo',
              localDir: '',
              optimizeForDisabled: false,
            })
          ).toMatchSnapshot();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
        it('does not throw', async () => {
          expect.assertions(2);
          httpMock
            .scope(urlHost)
            .get(`${urlPath}/rest/api/1.0/projects/SOME/repos/repo`)
            .reply(200, repoMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/branches/default`
            )
            .reply(200, {
              displayId: 'master',
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/browse/renovate.json?limit=20000`
            )
            .reply(200, {
              isLastPage: false,
              lines: ['{'],
              size: 50000,
            });
          const res = await bitbucket.initRepo({
            endpoint: 'https://stash.renovatebot.com/vcs/',
            repository: 'SOME/repo',
            localDir: '',
            optimizeForDisabled: true,
          });
          expect(res).toMatchSnapshot();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws disabled', async () => {
          expect.assertions(2);
          httpMock
            .scope(urlHost)
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/browse/renovate.json?limit=20000`
            )
            .reply(200, { isLastPage: true, lines: ['{ "enabled": false }'] });
          await expect(
            bitbucket.initRepo({
              endpoint: 'https://stash.renovatebot.com/vcs/',
              repository: 'SOME/repo',
              localDir: '',
              optimizeForDisabled: true,
            })
          ).rejects.toThrow(REPOSITORY_DISABLED);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('repoForceRebase()', () => {
        it('returns false on missing mergeConfig', async () => {
          expect.assertions(2);
          httpMock
            .scope(urlHost)
            .get(
              `${urlPath}/rest/api/1.0/projects/undefined/repos/undefined/settings/pull-requests`
            )
            .reply(200, {
              mergeConfig: null,
            });
          const actual = await bitbucket.getRepoForceRebase();
          expect(actual).toBe(false);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('returns false on missing defaultStrategy', async () => {
          expect.assertions(2);
          httpMock
            .scope(urlHost)
            .get(
              `${urlPath}/rest/api/1.0/projects/undefined/repos/undefined/settings/pull-requests`
            )
            .reply(200, {
              mergeConfig: {
                defaultStrategy: null,
              },
            });
          const actual = await bitbucket.getRepoForceRebase();
          expect(actual).toBe(false);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it.each(['ff-only', 'rebase-ff-only', 'squash-ff-only'])(
          'return true if %s strategy is enabled',
          async (id) => {
            expect.assertions(2);
            httpMock
              .scope(urlHost)
              .get(
                `${urlPath}/rest/api/1.0/projects/undefined/repos/undefined/settings/pull-requests`
              )
              .reply(200, {
                mergeConfig: {
                  defaultStrategy: {
                    id,
                  },
                },
              });
            const actual = await bitbucket.getRepoForceRebase();
            expect(actual).toBe(true);
            expect(httpMock.getTrace()).toMatchSnapshot();
          }
        );

        it.each(['no-ff', 'ff', 'rebase-no-ff', 'squash'])(
          'return false if %s strategy is enabled',
          async (id) => {
            expect.assertions(2);
            httpMock
              .scope(urlHost)
              .get(
                `${urlPath}/rest/api/1.0/projects/undefined/repos/undefined/settings/pull-requests`
              )
              .reply(200, {
                mergeConfig: {
                  defaultStrategy: {
                    id,
                  },
                },
              });
            const actual = await bitbucket.getRepoForceRebase();
            expect(actual).toBe(false);
            expect(httpMock.getTrace()).toMatchSnapshot();
          }
        );
      });

      describe('setBaseBranch()', () => {
        it('updates file list', async () => {
          expect.assertions(1);
          await initRepo();
          await bitbucket.setBaseBranch('branch');
          await bitbucket.setBaseBranch();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('deleteBranch()', () => {
        it('sends to gitFs', async () => {
          await initRepo();
          expect(await bitbucket.deleteBranch('branch')).toMatchSnapshot();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('commitFiles()', () => {
        it('sends to gitFs', async () => {
          expect.assertions(1);
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests?state=ALL&role.1=AUTHOR&username.1=abc&limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [prMock(url, 'SOME', 'repo')],
            });
          await bitbucket.commitFiles({
            branchName: 'some-branch',
            files: [{ name: 'test', contents: 'dummy' }],
            message: 'message',
          });
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('addAssignees()', () => {
        it('does not throw', async () => {
          expect(await bitbucket.addAssignees(3, ['some'])).toMatchSnapshot();
        });
      });

      describe('addReviewers', () => {
        it('does not throw', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .twice()
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .twice()
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .twice()
            .reply(200, prMock(url, 'SOME', 'repo'))
            .put(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'));

          expect(await bitbucket.addReviewers(5, ['name'])).toMatchSnapshot();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('sends the reviewer name as a reviewer', async () => {
          expect.assertions(1);
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .twice()
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .twice()
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .twice()
            .reply(200, prMock(url, 'SOME', 'repo'))
            .put(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'));

          await bitbucket.addReviewers(5, ['name']);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws not-found 1', async () => {
          await initRepo();
          await expect(
            bitbucket.addReviewers(null as any, ['name'])
          ).rejects.toThrow(REPOSITORY_NOT_FOUND);

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws not-found 2', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/4`
            )
            .reply(404);

          await expect(bitbucket.addReviewers(4, ['name'])).rejects.toThrow(
            REPOSITORY_NOT_FOUND
          );

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws not-found 3', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .put(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(404);

          await expect(bitbucket.addReviewers(5, ['name'])).rejects.toThrow(
            REPOSITORY_NOT_FOUND
          );

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws repository-changed', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .put(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(409);
          await expect(bitbucket.addReviewers(5, ['name'])).rejects.toThrow(
            REPOSITORY_CHANGED
          );
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .put(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(405);
          await expect(
            bitbucket.addReviewers(5, ['name'])
          ).rejects.toMatchObject({
            statusCode: 405,
          });
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('deleteLAbel()', () => {
        it('does not throw', async () => {
          expect(await bitbucket.deleteLabel(5, 'renovate')).toMatchSnapshot();
        });
      });

      describe('ensureComment()', () => {
        it('does not throw', async () => {
          httpMock
            .scope(urlHost)
            .get(
              `${urlPath}/rest/api/1.0/projects/undefined/repos/undefined/pull-requests/3/activities?limit=100`
            )
            .reply(200);
          const res = await bitbucket.ensureComment({
            number: 3,
            topic: 'topic',
            content: 'content',
          });
          expect(res).toBe(false);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('add comment if not found 1', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100`
            )
            .reply(200, {
              isLastPage: false,
              nextPageStart: 1,
              values: [
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 21, text: '### some-subject\n\nblablabla' },
                },
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 22, text: '!merge' },
                },
              ],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100&start=1`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ action: 'OTHER' }],
            })
            .post(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/comments`
            )
            .reply(200);

          expect(
            await bitbucket.ensureComment({
              number: 5,
              topic: 'topic',
              content: 'content',
            })
          ).toBe(true);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('add comment if not found 2', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100`
            )
            .reply(200, {
              isLastPage: false,
              nextPageStart: 1,
              values: [
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 21, text: '### some-subject\n\nblablabla' },
                },
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 22, text: '!merge' },
                },
              ],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100&start=1`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ action: 'OTHER' }],
            })
            .post(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/comments`
            )
            .reply(200);

          expect(
            await bitbucket.ensureComment({
              number: 5,
              topic: null,
              content: 'content',
            })
          ).toBe(true);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('add updates comment if necessary 1', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100`
            )
            .reply(200, {
              isLastPage: false,
              nextPageStart: 1,
              values: [
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 21, text: '### some-subject\n\nblablabla' },
                },
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 22, text: '!merge' },
                },
              ],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100&start=1`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ action: 'OTHER' }],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/comments/21`
            )
            .reply(200, {
              version: 1,
            })
            .put(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/comments/21`
            )
            .reply(200);

          expect(
            await bitbucket.ensureComment({
              number: 5,
              topic: 'some-subject',
              content: 'some\ncontent',
            })
          ).toBe(true);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('add updates comment if necessary 2', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100`
            )
            .reply(200, {
              isLastPage: false,
              nextPageStart: 1,
              values: [
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 21, text: '### some-subject\n\nblablabla' },
                },
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 22, text: '!merge' },
                },
              ],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100&start=1`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ action: 'OTHER' }],
            })
            .post(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/comments`
            )
            .reply(200);

          expect(
            await bitbucket.ensureComment({
              number: 5,
              topic: null,
              content: 'some\ncontent',
            })
          ).toBe(true);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('skips comment 1', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100`
            )
            .reply(200, {
              isLastPage: false,
              nextPageStart: 1,
              values: [
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 21, text: '### some-subject\n\nblablabla' },
                },
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 22, text: '!merge' },
                },
              ],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100&start=1`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ action: 'OTHER' }],
            });

          expect(
            await bitbucket.ensureComment({
              number: 5,
              topic: 'some-subject',
              content: 'blablabla',
            })
          ).toBe(true);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('skips comment 2', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100`
            )
            .reply(200, {
              isLastPage: false,
              nextPageStart: 1,
              values: [
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 21, text: '### some-subject\n\nblablabla' },
                },
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 22, text: '!merge' },
                },
              ],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100&start=1`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ action: 'OTHER' }],
            });

          const res = await bitbucket.ensureComment({
            number: 5,
            topic: null,
            content: '!merge',
          });
          expect(res).toBe(true);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('ensureCommentRemoval()', () => {
        it('does not throw', async () => {
          httpMock
            .scope(urlHost)
            .get(
              `${urlPath}/rest/api/1.0/projects/undefined/repos/undefined/pull-requests/5/activities?limit=100`
            )
            .reply(200, {
              isLastPage: false,
              nextPageStart: 1,
              values: [
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 21, text: '### some-subject\n\nblablabla' },
                },
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 22, text: '!merge' },
                },
              ],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/undefined/repos/undefined/pull-requests/5/activities?limit=100&start=1`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ action: 'OTHER' }],
            });
          await bitbucket.ensureCommentRemoval({ number: 5, topic: 'topic' });
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('deletes comment by topic if found', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100`
            )
            .reply(200, {
              isLastPage: false,
              nextPageStart: 1,
              values: [
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 21, text: '### some-subject\n\nblablabla' },
                },
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 22, text: '!merge' },
                },
              ],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100&start=1`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ action: 'OTHER' }],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/comments/21`
            )
            .reply(200, {
              version: 1,
            })
            .delete(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/comments/21?version=1`
            )
            .reply(200);

          await bitbucket.ensureCommentRemoval({
            number: 5,
            topic: 'some-subject',
          });
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('deletes comment by content if found', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100`
            )
            .reply(200, {
              isLastPage: false,
              nextPageStart: 1,
              values: [
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 21, text: '### some-subject\n\nblablabla' },
                },
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 22, text: '!merge' },
                },
              ],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100&start=1`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ action: 'OTHER' }],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/comments/22`
            )
            .reply(200, {
              version: 1,
            })
            .delete(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/comments/22?version=1`
            )
            .reply(200);

          await bitbucket.ensureCommentRemoval({
            number: 5,
            content: '!merge',
          });
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('deletes nothing', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100`
            )
            .reply(200, {
              isLastPage: false,
              nextPageStart: 1,
              values: [
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 21, text: '### some-subject\n\nblablabla' },
                },
                {
                  action: 'COMMENTED',
                  commentAction: 'ADDED',
                  comment: { id: 22, text: '!merge' },
                },
              ],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/activities?limit=100&start=1`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ action: 'OTHER' }],
            });

          await bitbucket.ensureCommentRemoval({ number: 5, topic: 'topic' });
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('getPrList()', () => {
        it('has pr', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests?state=ALL&role.1=AUTHOR&username.1=abc&limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [prMock(url, 'SOME', 'repo')],
            });
          expect(await bitbucket.getPrList()).toMatchSnapshot();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('getBranchPr()', () => {
        it('has pr', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests?state=ALL&role.1=AUTHOR&username.1=abc&limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [prMock(url, 'SOME', 'repo')],
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            });

          expect(
            await bitbucket.getBranchPr('userName1/pullRequest5')
          ).toMatchSnapshot();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
        it('has no pr', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests?state=ALL&role.1=AUTHOR&username.1=abc&limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [prMock(url, 'SOME', 'repo')],
            });

          expect(
            await bitbucket.findPr({
              branchName: 'userName1/pullRequest1',
            })
          ).toBeUndefined();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('findPr()', () => {
        it('has pr', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests?state=ALL&role.1=AUTHOR&username.1=abc&limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [prMock(url, 'SOME', 'repo')],
            });

          expect(
            await bitbucket.findPr({
              branchName: 'userName1/pullRequest5',
              prTitle: 'title',
              state: PR_STATE_OPEN,
            })
          ).toMatchSnapshot();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
        it('has no pr', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests?state=ALL&role.1=AUTHOR&username.1=abc&limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [prMock(url, 'SOME', 'repo')],
            });

          expect(
            await bitbucket.findPr({
              branchName: 'userName1/pullRequest5',
              prTitle: 'title',
              state: PR_STATE_CLOSED,
            })
          ).toBeUndefined();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('createPr()', () => {
        it('posts PR', async () => {
          const scope = await initRepo();
          scope
            .get(`${urlPath}/rest/api/1.0/projects/SOME/repos/repo`)
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/default-reviewers/1.0/projects/SOME/repos/repo/reviewers?sourceRefId=refs/heads/branch&targetRefId=refs/heads/master&sourceRepoId=5&targetRepoId=5`
            )
            .reply(200, [{ name: 'jcitizen' }])
            .post(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests`
            )
            .reply(200, prMock(url, 'SOME', 'repo'));

          const { number: id } = await bitbucket.createPr({
            branchName: 'branch',
            prTitle: 'title',
            prBody: 'body',
          });
          expect(id).toBe(5);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('posts PR default branch', async () => {
          const scope = await initRepo();
          scope
            .get(`${urlPath}/rest/api/1.0/projects/SOME/repos/repo`)
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/default-reviewers/1.0/projects/SOME/repos/repo/reviewers?sourceRefId=refs/heads/branch&targetRefId=refs/heads/master&sourceRepoId=5&targetRepoId=5`
            )
            .reply(200, [{ name: 'jcitizen' }])
            .post(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests`
            )
            .reply(200, prMock(url, 'SOME', 'repo'));

          const { number: id } = await bitbucket.createPr({
            branchName: 'branch',
            prTitle: 'title',
            prBody: 'body',
            labels: null,
            useDefaultBranch: true,
          });
          expect(id).toBe(5);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('getPr()', () => {
        it('returns null for no prNo', async () => {
          httpMock.scope(urlHost);
          expect(await bitbucket.getPr(undefined as any)).toBeNull();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
        it('gets a PR', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            });

          expect(await bitbucket.getPr(5)).toMatchSnapshot();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('canRebase', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/3`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/3/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/3/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 2,
            })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .twice()
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .twice()
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .twice()
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            });

          const author = global.gitAuthor;
          try {
            expect(await bitbucket.getPr(3)).toMatchSnapshot();

            global.gitAuthor = { email: 'bot@renovateapp.com', name: 'bot' };
            expect(await bitbucket.getPr(5)).toMatchSnapshot();

            global.gitAuthor = { email: 'jane@example.com', name: 'jane' };
            expect(await bitbucket.getPr(5)).toMatchSnapshot();

            expect(httpMock.getTrace()).toMatchSnapshot();
          } finally {
            global.gitAuthor = author;
          }
        });

        it('gets a closed PR', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, {
              version: 0,
              number: 5,
              state: 'MERGED',
              reviewers: [],
              fromRef: {},
              toRef: {},
            });

          expect(await bitbucket.getPr(5)).toMatchSnapshot();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('updatePr()', () => {
        it('puts PR', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .put(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200);

          await bitbucket.updatePr(5, 'title', 'body');
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws not-found 1', async () => {
          await initRepo();
          await expect(
            bitbucket.updatePr(null as any, 'title', 'body')
          ).rejects.toThrow(REPOSITORY_NOT_FOUND);

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws not-found 2', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/4`
            )
            .reply(404);
          await expect(bitbucket.updatePr(4, 'title', 'body')).rejects.toThrow(
            REPOSITORY_NOT_FOUND
          );

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws not-found 3', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .put(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(404);

          await expect(bitbucket.updatePr(5, 'title', 'body')).rejects.toThrow(
            REPOSITORY_NOT_FOUND
          );

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws repository-changed', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .put(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(409);

          await expect(bitbucket.updatePr(5, 'title', 'body')).rejects.toThrow(
            REPOSITORY_CHANGED
          );
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .put(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(405);

          await expect(
            bitbucket.updatePr(5, 'title', 'body')
          ).rejects.toMatchObject({
            statusCode: 405,
          });
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('mergePr()', () => {
        it('posts Merge', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .post(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge?version=1`
            )
            .reply(200);

          expect(await bitbucket.mergePr(5, 'branch')).toBe(true);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws not-found 1', async () => {
          await initRepo();
          const res = bitbucket.mergePr(null as any, 'branch');
          await expect(res).rejects.toThrow(REPOSITORY_NOT_FOUND);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws not-found 2', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/4`
            )
            .reply(404);

          await expect(bitbucket.mergePr(4, 'branch')).rejects.toThrow(
            REPOSITORY_NOT_FOUND
          );
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws not-found 3', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .post(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge?version=1`
            )
            .reply(404);

          await expect(bitbucket.mergePr(5, 'branch')).rejects.toThrow(
            REPOSITORY_NOT_FOUND
          );
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws conflicted', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .post(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge?version=1`
            )
            .reply(409);

          expect(await bitbucket.mergePr(5, 'branch')).toBeFalsy();
          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('unknown error', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5`
            )
            .reply(200, prMock(url, 'SOME', 'repo'))
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge`
            )
            .reply(200, { conflicted: false })
            .get(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/commits?withCounts=true`
            )
            .reply(200, {
              totalCount: 1,
              values: [{ author: { emailAddress: 'bot@renovateapp.com' } }],
            })
            .post(
              `${urlPath}/rest/api/1.0/projects/SOME/repos/repo/pull-requests/5/merge?version=1`
            )
            .reply(405);

          await expect(bitbucket.mergePr(5, 'branch')).resolves.toBe(false);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('getPrBody()', () => {
        it('returns diff files', () => {
          expect(
            bitbucket.getPrBody(
              '<details><summary>foo</summary>bar</details>text<details>'
            )
          ).toMatchSnapshot();
        });

        it('sanitizes HTML comments in the body', () => {
          const prBody = bitbucket.getPrBody(`---

- [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box
- [ ] <!-- recreate-branch=renovate/docker-renovate-renovate-16.x --><a href="/some/link">Update renovate/renovate to 16.1.2</a>

---
<!---->
Empty comment.
<!-- This is another comment -->
Followed by some information.
<!-- followed by some more comments -->`);
          expect(prBody).toMatchSnapshot();
        });
      });

      describe('getVulnerabilityAlerts()', () => {
        it('returns empty array', async () => {
          expect.assertions(1);
          expect(await bitbucket.getVulnerabilityAlerts()).toEqual([]);
        });
      });

      describe('getBranchStatus()', () => {
        it('should be success', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/stats/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200, {
              successful: 3,
              inProgress: 0,
              failed: 0,
            });

          expect(await bitbucket.getBranchStatus('somebranch', [])).toEqual(
            BranchStatus.green
          );

          expect(await bitbucket.getBranchStatus('somebranch')).toEqual(
            BranchStatus.green
          );

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('should be pending', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/stats/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200, {
              successful: 3,
              inProgress: 1,
              failed: 0,
            });

          expect(await bitbucket.getBranchStatus('somebranch', [])).toEqual(
            BranchStatus.yellow
          );

          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/stats/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200, {
              successful: 0,
              inProgress: 0,
              failed: 0,
            });

          expect(await bitbucket.getBranchStatus('somebranch', [])).toEqual(
            BranchStatus.yellow
          );

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('should be failed', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/stats/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200, {
              successful: 1,
              inProgress: 1,
              failed: 1,
            });

          expect(await bitbucket.getBranchStatus('somebranch', [])).toEqual(
            BranchStatus.red
          );

          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/stats/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .replyWithError('requst-failed');

          expect(await bitbucket.getBranchStatus('somebranch', [])).toEqual(
            BranchStatus.red
          );

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('throws repository-changed', async () => {
          git.branchExists.mockResolvedValue(false);
          await initRepo();
          await expect(
            bitbucket.getBranchStatus('somebranch', [])
          ).rejects.toThrow(REPOSITORY_CHANGED);
          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('getBranchStatusCheck()', () => {
        it('should be success', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [
                {
                  state: 'SUCCESSFUL',
                  key: 'context-2',
                  url: 'https://renovatebot.com',
                },
              ],
            });

          expect(
            await bitbucket.getBranchStatusCheck('somebranch', 'context-2')
          ).toEqual(BranchStatus.green);

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('should be pending', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [
                {
                  state: 'INPROGRESS',
                  key: 'context-2',
                  url: 'https://renovatebot.com',
                },
              ],
            });

          expect(
            await bitbucket.getBranchStatusCheck('somebranch', 'context-2')
          ).toEqual(BranchStatus.yellow);

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('should be failure', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [
                {
                  state: 'FAILED',
                  key: 'context-2',
                  url: 'https://renovatebot.com',
                },
              ],
            });

          expect(
            await bitbucket.getBranchStatusCheck('somebranch', 'context-2')
          ).toEqual(BranchStatus.red);

          expect(httpMock.getTrace()).toMatchSnapshot();
        });

        it('should be null', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .replyWithError('requst-failed');

          expect(
            await bitbucket.getBranchStatusCheck('somebranch', 'context-2')
          ).toBeNull();

          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [],
            });

          expect(
            await bitbucket.getBranchStatusCheck('somebranch', 'context-2')
          ).toBeNull();

          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });

      describe('setBranchStatus()', () => {
        it('should be success 1', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .twice()
            .reply(200, {
              isLastPage: true,
              values: [{ key: 'context-1', state: 'SUCCESSFUL' }],
            })
            .post(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200)
            .get(
              `${urlPath}/rest/build-status/1.0/commits/stats/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200, {});

          await bitbucket.setBranchStatus({
            branchName: 'somebranch',
            context: 'context-2',
            description: null as any,
            state: BranchStatus.green,
          });

          expect(httpMock.getTrace()).toMatchSnapshot();
        });
        it('should be success 2', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .twice()
            .reply(200, {
              isLastPage: true,
              values: [{ key: 'context-1', state: 'SUCCESSFUL' }],
            })
            .post(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200)
            .get(
              `${urlPath}/rest/build-status/1.0/commits/stats/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200, {});

          await bitbucket.setBranchStatus({
            branchName: 'somebranch',
            context: 'context-2',
            description: null as any,
            state: BranchStatus.red,
          });

          expect(httpMock.getTrace()).toMatchSnapshot();
        });
        it('should be success 3', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .twice()
            .reply(200, {
              isLastPage: true,
              values: [{ key: 'context-1', state: 'SUCCESSFUL' }],
            })
            .post(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200)
            .get(
              `${urlPath}/rest/build-status/1.0/commits/stats/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200, {});

          await bitbucket.setBranchStatus({
            branchName: 'somebranch',
            context: 'context-2',
            description: null as any,
            state: BranchStatus.red,
          });

          expect(httpMock.getTrace()).toMatchSnapshot();
        });
        it('should be success 4', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .twice()
            .reply(200, {
              isLastPage: true,
              values: [{ key: 'context-1', state: 'SUCCESSFUL' }],
            })
            .post(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200)
            .get(
              `${urlPath}/rest/build-status/1.0/commits/stats/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .reply(200, {});

          await bitbucket.setBranchStatus({
            branchName: 'somebranch',
            context: 'context-2',
            description: null as any,
            state: BranchStatus.yellow,
          });

          expect(httpMock.getTrace()).toMatchSnapshot();
        });
        it('should be success 5', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ key: 'context-1', state: 'SUCCESSFUL' }],
            })
            .post(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e`
            )
            .replyWithError('requst-failed');

          await bitbucket.setBranchStatus({
            branchName: 'somebranch',
            context: 'context-2',
            description: null as any,
            state: BranchStatus.green,
          });

          expect(httpMock.getTrace()).toMatchSnapshot();
        });
        it('should be success 6', async () => {
          const scope = await initRepo();
          scope
            .get(
              `${urlPath}/rest/build-status/1.0/commits/0d9c7726c3d628b7e28af234595cfd20febdbf8e?limit=100`
            )
            .reply(200, {
              isLastPage: true,
              values: [{ key: 'context-1', state: 'SUCCESSFUL' }],
            });

          await bitbucket.setBranchStatus({
            branchName: 'somebranch',
            context: 'context-1',
            description: null as any,
            state: BranchStatus.green,
          });

          expect(httpMock.getTrace()).toMatchSnapshot();
        });
      });
    });
  });
});
