# Changelog

## [0.10.0](https://github.com/blastin-dev/clocktopus/compare/cli-v0.9.0...cli-v0.10.0) (2026-10-27)


### Features

* **clk-55:** show the session's task, attribution and goal in Claude Code ([958ba18](https://github.com/blastin-dev/clocktopus/commit/958ba1810d136bc52d4e53f166c1bec71679a176))
* **clk-60:** let agent setup install the Claude Code session panel on 2.1.310 or later ([a31230d](https://github.com/blastin-dev/clocktopus/commit/a31230d13747ca0dc09fd2ec66f29bf2bfde4ee4))
* **clk-62:** let the CLI upgrade itself however it was installed, and show its version in the session panel ([abc97d8](https://github.com/blastin-dev/clocktopus/commit/abc97d8fdd39d46fc079b770c7a24eef881c37b5))
* **clk-63:** review the work start-work just did before the developer reads it ([f123c34](https://github.com/blastin-dev/clocktopus/commit/f123c34d9faad176e24bfd123216afd9c3fd23ff))
* **clk-63:** review the work start-work just did, fixing the sure findings and leaving the rest on the pull request ([b5fcdb5](https://github.com/blastin-dev/clocktopus/commit/b5fcdb5b7d03290fa887a84a25a6d900a1603315))


### Bug Fixes

* **clk-57:** resolve SSH host alias remotes so their sessions reach a project ([#513](https://github.com/blastin-dev/clocktopus/issues/513)) ([2ace678](https://github.com/blastin-dev/clocktopus/commit/2ace67818c07e3f4ba1076b3352e4a3488719ce9))
* **clk-62:** refresh only after a newer version, from an install that lasts ([59b228e](https://github.com/blastin-dev/clocktopus/commit/59b228e2da3e163d647cfd4062ab1ad2a106ca5d))
* **clk-63:** keep review-work to its own layer of a goal's stack ([d5f5e15](https://github.com/blastin-dev/clocktopus/commit/d5f5e1546b722f2a0ac9f27743ef822d29bb39f5))

## [0.9.0](https://github.com/blastin-dev/clocktopus/compare/cli-v0.8.1...cli-v0.9.0) (2026-10-25)


### Features

* **clk-33:** keep the time of each prompt from interactive Claude Code sessions ([#485](https://github.com/blastin-dev/clocktopus/issues/485)) ([f15a1ed](https://github.com/blastin-dev/clocktopus/commit/f15a1edc1b1c856be71d8067b19e1e22f630f298))


### Bug Fixes

* **clk-52:** patch npm security advisories ([9b688f7](https://github.com/blastin-dev/clocktopus/commit/9b688f784c5a93b7a842fca7213d1fac986b92e7))
* **deps:** clear the high audit advisories ([1c2fadc](https://github.com/blastin-dev/clocktopus/commit/1c2fadc21a480feb7d21f45bc44f50a089d79d64))

## [0.8.1](https://github.com/blastin-dev/clocktopus/compare/cli-v0.8.0...cli-v0.8.1) (2026-10-20)


### Bug Fixes

* **clk-27:** update an installed Claude Code plugin to the CLI's version on setup ([9f14f45](https://github.com/blastin-dev/clocktopus/commit/9f14f45245672b9a6f66ca280194836d18d33092))
* **clk-27:** update an installed Claude Code plugin to the CLI's version on setup ([e1e8dc6](https://github.com/blastin-dev/clocktopus/commit/e1e8dc6367eded9a0f8ff0d4aa384a602d7ed297))

## [0.8.0](https://github.com/blastin-dev/clocktopus/compare/cli-v0.7.1...cli-v0.8.0) (2026-10-15)


### Features

* **clk-18:** send the agent session's directory as ~/… instead of the full path ([bd6568a](https://github.com/blastin-dev/clocktopus/commit/bd6568af087204aee1e8948aeef1ff75a0d96579))
* **clk-19:** print what `agent hook` would send with CLOCKTOPUS_HOOK_DRY_RUN ([debc8dc](https://github.com/blastin-dev/clocktopus/commit/debc8dc99c410caab4a9afa974cdc34dc125ac7e))
* **clk-23:** agent doctor warns when a managed Claude Code policy turns a content flag on ([aff60c3](https://github.com/blastin-dev/clocktopus/commit/aff60c3d22eb0cf604555a4c3efd7c3ad3fc31d2))
* **clk-23:** warn in `agent doctor` and `agent status` when a managed Claude Code settings file turns a content flag on ([03ea146](https://github.com/blastin-dev/clocktopus/commit/03ea14684f7c022f4a8028cacdf9538dcc7f6469))
* **clk-2:** tell outdated CLIs to upgrade ([8896349](https://github.com/blastin-dev/clocktopus/commit/8896349462734197a1f4d5e337c8efcdb6ec432c))
* **clk-6:** tell the CLI when a newer version is out ([5d59de0](https://github.com/blastin-dev/clocktopus/commit/5d59de09fd9ea95c3bbeec2f4d5c32f463736ea1))


### Bug Fixes

* **clk-16:** keep Codex spend cursors through agent disable and prune stale ones ([718fbe2](https://github.com/blastin-dev/clocktopus/commit/718fbe2cd7920eb3bcf6a0380fe8229c1ab3dd84))
* **clk-16:** report Codex spend from its session file instead of its log exporter ([ff4fd47](https://github.com/blastin-dev/clocktopus/commit/ff4fd47ecfaf34d6673337ca91e264aad9f7f0f1))
* **clk-17:** keep Claude Code prompts and tool details out of telemetry ([5c03a7b](https://github.com/blastin-dev/clocktopus/commit/5c03a7b9ec21c388371743e31d958cf22764f01b))
* **clk-22:** send git remotes without their credentials ([91b8f27](https://github.com/blastin-dev/clocktopus/commit/91b8f27e1bf2020e4c92cab83e861a6727f8afb9))
* **clk-6:** announce only the CLI version npm actually has ([402682a](https://github.com/blastin-dev/clocktopus/commit/402682acaaf16975f033e71393e6b040a141f219))
* **clk-7:** reject non-ISO timestamps in the CLI contract ([6cf32fd](https://github.com/blastin-dev/clocktopus/commit/6cf32fd5ba2154222cd41e1ff3ea4d7cf0da9d40))
