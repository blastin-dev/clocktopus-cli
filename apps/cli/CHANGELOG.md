# Changelog

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
