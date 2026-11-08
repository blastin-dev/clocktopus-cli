# Changelog

## [0.14.0](https://github.com/blastin-dev/clocktopus/compare/cli-v0.13.0...cli-v0.14.0) (2026-11-08)


### Features

* **clk-112:** mark the Herdr panel's task in view and a session's other tasks ([b49a6b7](https://github.com/blastin-dev/clocktopus/commit/b49a6b7b8d0efa980ab5078dd7cc4297abfcf976))
* **clk-112:** mark the Herdr panel's task in view and a session's other tasks ([cef9ba7](https://github.com/blastin-dev/clocktopus/commit/cef9ba7bc51efc13a8e2d54c47995367fa7b06da))
* **clk-112:** rename the tabs the Herdr panel opened to the task their agent is on now ([2e70998](https://github.com/blastin-dev/clocktopus/commit/2e7099813d731a6cb242840554c7bf3443f878bd))
* **clk-115:** place start-work's worktree for every agent, and keep agents that can't move in the checkout ([eb5aade](https://github.com/blastin-dev/clocktopus/commit/eb5aade5717ce0823a8a92cf8faeb58628523c0d))
* **clk-115:** start-work works in a worktree by default ([1b8dc7d](https://github.com/blastin-dev/clocktopus/commit/1b8dc7dd4dc0ecd4e81aa048117b69dda3fb26ee))
* **clk-115:** start-work works in a worktree by default ([2aad3d8](https://github.com/blastin-dev/clocktopus/commit/2aad3d8645c3c65952d68f7e547a62aba3a3be7b))
* **clk-117:** list ready to ship tasks in the Herdr panel and clocktopus tasks ([af41f12](https://github.com/blastin-dev/clocktopus/commit/af41f12d761aaf96959fcbe33d1d2dedf7e1d7fe))
* **clk-117:** list ready to ship tasks in the Herdr panel and clocktopus tasks ([9db1022](https://github.com/blastin-dev/clocktopus/commit/9db1022c374b844002b8c68d63afa3940c656c26))
* **clk-118:** a More actions menu on every Herdr task row, opening a worktree with a terminal or an agent ([18f1ec0](https://github.com/blastin-dev/clocktopus/commit/18f1ec0eacdc1d23d038a8ed820d45aa3fa079ee))
* **clk-118:** ask to open the task's worktree or name another when New worktree finds one in the Herdr panel ([6580b97](https://github.com/blastin-dev/clocktopus/commit/6580b9774ff7955c814d472cdef50282a7407293))
* **clk-118:** leave out of the Herdr panel a Claude Code session that ended before its first message ([e5ffcee](https://github.com/blastin-dev/clocktopus/commit/e5ffcee9ebe1175630707516dd328995db4144ab))
* **clk-118:** let the Herdr panel start a task in any installed agent ([5e1ec2d](https://github.com/blastin-dev/clocktopus/commit/5e1ec2dabbb3800a93b00bb2c946178304cb590c))
* **clk-118:** list every worktree of the task in the Herdr panel's worktree dialog, each one click to open ([51f2166](https://github.com/blastin-dev/clocktopus/commit/51f216664d6bb776b48339b94ab6119e01777be6))
* **clk-118:** list the agents Clocktopus tracks first in the Herdr More actions menu ([b3486a5](https://github.com/blastin-dev/clocktopus/commit/b3486a5d0a1e86f85111afafa9ab3f420be701c7))
* **clk-118:** open the chosen agent in the task's new worktree from the Herdr More actions menu ([7af980d](https://github.com/blastin-dev/clocktopus/commit/7af980d71ba459ad7d35a3eb88c45fcc496b9588))
* **clk-118:** open the task's existing worktree from the Herdr More actions menu, or a new one under the next free name ([36a37ab](https://github.com/blastin-dev/clocktopus/commit/36a37abb690f44c55136a270beba174b6f588961))
* **clk-118:** replace the Herdr panel's Start menu with a More actions menu on every row ([7b7653d](https://github.com/blastin-dev/clocktopus/commit/7b7653d5d21eddcc8c56e142c3ecff2221092517))
* **clk-118:** start a Herdr panel task in any installed agent, not only Claude Code ([a42284a](https://github.com/blastin-dev/clocktopus/commit/a42284aae0b40bdfcdc00c79069afac77f20ae7b))
* **clk-118:** start a task from one menu in the Herdr panel, with a new worktree first ([29cc3d6](https://github.com/blastin-dev/clocktopus/commit/29cc3d65684fb50fd3422e03cba9bf98344bd096))
* **clk-118:** start a task from one menu in the Herdr panel, with a new worktree first ([58a60e5](https://github.com/blastin-dev/clocktopus/commit/58a60e569881bcbf7483768d8d14f18a9fdfb2a3))
* **clk-122:** show each task's pull requests in the Herdr and Claude Code panels ([309accb](https://github.com/blastin-dev/clocktopus/commit/309accbd028f420627af55d097d274823d018d17))
* **clk-122:** show each task's pull requests in the Herdr and Claude Code panels ([d028c62](https://github.com/blastin-dev/clocktopus/commit/d028c625ce58290daf9786416794e2baf7919e83))


### Bug Fixes

* **clk-112:** keep a session of yours working outside Herdr once the moved-on agent is no longer current ([f6bb866](https://github.com/blastin-dev/clocktopus/commit/f6bb866c60a978dbe080f809323b861cac139995))
* **clk-112:** keep the open task when switching to a space at another checkout ([024d2bf](https://github.com/blastin-dev/clocktopus/commit/024d2bffaa930dcecd05aee0195a0ce76992c44a))
* **clk-112:** mark the task and session in view with an accent border, not a fill ([0534773](https://github.com/blastin-dev/clocktopus/commit/0534773de97610b1347abf63579851c6671e60ba))
* **clk-112:** show a moved-on agent over its stale board entry, and reveal the rows its session links to ([1ecb3f3](https://github.com/blastin-dev/clocktopus/commit/1ecb3f3c2d86bad450258d97661a31443d99366e))
* **clk-113:** keep the Herdr panel rendering while an agent is working on a listed task ([3169bdd](https://github.com/blastin-dev/clocktopus/commit/3169bdd4d9bd4a65967077e86ab9412eef0777c4))
* **clk-113:** keep the Herdr panel rendering while an agent is working on a listed task ([127a412](https://github.com/blastin-dev/clocktopus/commit/127a412c71d28b060c9322f1099d7d363a59de4a))
* **clk-115:** keep the worktree start-work leaves, and defer case 2 to case 3 ([4b990e3](https://github.com/blastin-dev/clocktopus/commit/4b990e300be86d9ccf58d5fb014e977bed7b0641))
* **clk-115:** name the worktree, its base and its setup in start-work ([9fabeea](https://github.com/blastin-dev/clocktopus/commit/9fabeeaf475ba3b109198437466236672ce50b68))
* **clk-118:** cap the Herdr More actions menu at 491px and scroll its agents ([d60c1d5](https://github.com/blastin-dev/clocktopus/commit/d60c1d5bcdb533ef6508d56b7dfe525066541b56))
* **clk-118:** draw the Herdr board before the installed agents arrive ([30a4334](https://github.com/blastin-dev/clocktopus/commit/30a433418f8ff7b851b0573a69a1d1d2b75318a5))
* **clk-118:** keep the one-agent start popup a single click, with room to wrap ([ae1d9dd](https://github.com/blastin-dev/clocktopus/commit/ae1d9dd92ee3cf200115fd65266757f071487a08))
* **clk-118:** list the installed agents in the Herdr More actions menu as soon as the board loads ([9905ec2](https://github.com/blastin-dev/clocktopus/commit/9905ec2f58eafde9babb79de4577a1c4a0e8cea0))
* **clk-118:** tie a Herdr terminal with no agent to the task its branch names, and stop counting the agent block's agent in view over it ([338a462](https://github.com/blastin-dev/clocktopus/commit/338a462048f365f42a694ebf3898a8dfd4f718d6))
* **clk-118:** tighten the Herdr worktree dialog and terminal rows after review ([68d68e5](https://github.com/blastin-dev/clocktopus/commit/68d68e51b3f00b1c9131c831466857175f718978))
* **clk-118:** wait at most 3 s for the Herdr menu's worktree lookup, and find a worktree's space against every worktree ([8391107](https://github.com/blastin-dev/clocktopus/commit/8391107a31c05f28a6e2cb5dc8a9898dd6cef153))
* **clk-120:** follow a branch only when the session's own move changed it ([a4b570e](https://github.com/blastin-dev/clocktopus/commit/a4b570ecfa4bf6f2a917b8bddbc574cbd09c1d3f))
* **clk-120:** stop sessions sharing a checkout from being tied to each other's tasks ([c8ac317](https://github.com/blastin-dev/clocktopus/commit/c8ac31789c385a46a7f02bdfb6d26ba4bce05de1))
* **clk-120:** tie a session to its branch's task from the panel only after the session moved itself ([df5f710](https://github.com/blastin-dev/clocktopus/commit/df5f7102f5c7fb506aaa44fb8f1e3a6b2b2e311c))
* **clk-121:** keep the Codex exporter reader's comment true to the hook ([8c05347](https://github.com/blastin-dev/clocktopus/commit/8c05347201d3f299a313da30821bd5ca9d0e3e5b))
* **clk-121:** report Codex spend through the hook even while an older setup's exporter remains ([ada2b78](https://github.com/blastin-dev/clocktopus/commit/ada2b78dccae2236f98c5290e76ce760d97abb25))
* **clk-122:** open a task's pull request from the panels only at an http(s) link ([5587b77](https://github.com/blastin-dev/clocktopus/commit/5587b77dbf2b433f245cf357e5ebabcfe3cb3225))

## [0.13.0](https://github.com/blastin-dev/clocktopus/compare/cli-v0.12.0...cli-v0.13.0) (2026-11-07)


### Features

* **clk-102:** add a Herdr layout with a Clocktopus task panel beside the agents ([87eaf4f](https://github.com/blastin-dev/clocktopus/commit/87eaf4f65c2488e852bdaa22f51e22351d315fed))
* **clk-102:** Herdr layout with a Clocktopus task panel ([3c448f2](https://github.com/blastin-dev/clocktopus/commit/3c448f288b1afc07517553761444af9956af7098))
* **clk-102:** label each Herdr terminal with its agent session and current task ([0bfbe6c](https://github.com/blastin-dev/clocktopus/commit/0bfbe6c9094ae6303b0fc08db21bc4342167b9e6))
* **clk-102:** refresh the Herdr panel on Clocktopus's change hints ([01af574](https://github.com/blastin-dev/clocktopus/commit/01af57421b938397f8f46742f7b5b704ce46323b))
* **clk-103:** add `clocktopus tasks` and the task board route it reads ([e8a8770](https://github.com/blastin-dev/clocktopus/commit/e8a8770caa4f0cda26246802b8e6682aac37aae9))
* **clk-103:** CLI task board and realtime change hints for the panels ([494b983](https://github.com/blastin-dev/clocktopus/commit/494b9833e4cda2421fd882c80cd7ed8885a7f915))
* **clk-103:** follow Clocktopus's change hints from the CLI and the Claude panel ([4d54a8e](https://github.com/blastin-dev/clocktopus/commit/4d54a8e0fc9f23554f96b76484eb65d9a2eccad5))
* **clk-106:** move the session into the worktree it works in ([20c0090](https://github.com/blastin-dev/clocktopus/commit/20c009037ee2dd9a5f63c9d78cb0d5c8876ff4fd))
* **clk-106:** move the session into the worktree it works in ([47ff85a](https://github.com/blastin-dev/clocktopus/commit/47ff85acb9f7dc41dadfcf6d55c8dad7d8aa22a5))
* **clk-111:** cross-check review-work findings with a second model ([2ee0819](https://github.com/blastin-dev/clocktopus/commit/2ee0819da54d1fad6d53184917c4f58824c2926d))
* **clk-111:** cross-check review-work findings with a second model ([18718d5](https://github.com/blastin-dev/clocktopus/commit/18718d550faa8468fa10d7ebafe1acf6345b691e))


### Bug Fixes

* **clk-102:** keep a change hint that lands mid-load and label Herdr terminals only with a task Clocktopus tied ([55a0cb6](https://github.com/blastin-dev/clocktopus/commit/55a0cb6546a62676337e1b5b9fadeb7ed1f57aa5))
* **clk-102:** list a Herdr task's agents and sessions together in its open card, with cooking in amber ([e7928e2](https://github.com/blastin-dev/clocktopus/commit/e7928e22b7c64d783256c2be8a98cc1ddbce70c7))
* **clk-102:** make the Herdr panel's open task card compact, with one Open in Clocktopus ([5c72b58](https://github.com/blastin-dev/clocktopus/commit/5c72b58b2153bfac9542045e7189d5fdae845587))
* **clk-102:** read the task board's sessions for open tasks only, across the repository's projects, and keep every task in review ([647eb01](https://github.com/blastin-dev/clocktopus/commit/647eb01dc221b33dcdead421d163e0146f3b2e4f))
* **clk-103:** keep a realtime watcher started from a Herdr mod running after its exec returns ([586cebe](https://github.com/blastin-dev/clocktopus/commit/586cebea9182ec4f547b01d444625afa2ec80047))
* **clk-103:** keep one realtime watcher per machine and stop retrying a stage without realtime ([7f186b6](https://github.com/blastin-dev/clocktopus/commit/7f186b6c022ca8b979e3afcac568339ab9b55262))
* **clk-106:** point a session already in a worktree at ExitWorktree, and note a failed cd ([b9e4ba9](https://github.com/blastin-dev/clocktopus/commit/b9e4ba95a86b49a0e3970b76e0361c95e2ad25fe))
* **clk-111:** push on every path, keep disputed answers open, and list unchecked fixes ([e3a715f](https://github.com/blastin-dev/clocktopus/commit/e3a715ff92d2ec7a917101d4758497db1fa8008f))
* **clk-111:** reach both reviewers as harness subagents and close the loop's gaps ([bed03e8](https://github.com/blastin-dev/clocktopus/commit/bed03e8c60f0e0429ec1c1734f8d4d00eddcd78c))

## [0.12.0](https://github.com/blastin-dev/clocktopus/compare/cli-v0.11.0...cli-v0.12.0) (2026-11-04)


### Features

* **clk-82:** create a project's tasks in the connected tracker its tickets come from ([c9a918a](https://github.com/blastin-dev/clocktopus/commit/c9a918a1637950cc4c604855f96584c8d4826d68))
* **clk-84:** declare the ticket prefixes a checkout uses during init ([b74058d](https://github.com/blastin-dev/clocktopus/commit/b74058d8b379f56943a3878b69fcae00fec45192))
* **clk-85:** date a registered ticket from the tracker and follow its key ([37954c5](https://github.com/blastin-dev/clocktopus/commit/37954c54a6d053248fac80e543ec25e1a1a2f3e9))
* **clk-85:** register tasks created in a tracker and tracker tickets the user names ([eee14dd](https://github.com/blastin-dev/clocktopus/commit/eee14ddbabe358a8666e1650c247ec081b3e53c4))
* **clk-86:** plan a goal from a Linear or Jira ticket with create-goal ([4f51cfa](https://github.com/blastin-dev/clocktopus/commit/4f51cfa245f6e7bdba0b1e5efa1e636ab7d7b414))
* **clk-86:** plan a ticket's goal as sub-tasks in its tracker ([6c31477](https://github.com/blastin-dev/clocktopus/commit/6c31477c3a642c6c310818e097cdb8cb0c8835ce))
* **clk-97:** show the worktree the session's task is worked in on the panel ([b721c21](https://github.com/blastin-dev/clocktopus/commit/b721c21d29891e6f27323fc74affa97eeeef1777))
* **clk-97:** show the worktree the session's task is worked in on the panel ([0bd42c8](https://github.com/blastin-dev/clocktopus/commit/0bd42c82e6831842f6c50c7821e7d6f0058aea40))
* **clk-98:** add a register-ticket skill other workflows can call ([1f998b1](https://github.com/blastin-dev/clocktopus/commit/1f998b1f0fb69c13a0088c414db86f5677913dd1))
* **clk-98:** add a register-ticket skill other workflows can call ([98d9a8e](https://github.com/blastin-dev/clocktopus/commit/98d9a8e6c6e3f397d4e314e98a824cee0aaeb46e))


### Bug Fixes

* **clk-77:** tie a session to the task of the branch it moves to ([7f21be8](https://github.com/blastin-dev/clocktopus/commit/7f21be88090a918d18660ca44e731c3649c94773))
* **clk-84:** declare only prefixes at least two commits or branches use ([14e56fd](https://github.com/blastin-dev/clocktopus/commit/14e56fdb72a78544194049e9adfcc545e444b683))
* **clk-86:** take any key outside the project's prefix as a ticket in create-goal ([b361cf5](https://github.com/blastin-dev/clocktopus/commit/b361cf567fb0f01e2d2668da6613642fb375325a))
* **clk-95:** list tasks while no git provider is connected ([7f66dd9](https://github.com/blastin-dev/clocktopus/commit/7f66dd927aa39054b4d8b249bfc8d5b301b83454))
* **clk-97:** skip a deleted worktree git still lists when following the task's checkout ([fcbc6a2](https://github.com/blastin-dev/clocktopus/commit/fcbc6a2c4ce0274b4c6a6783e5422849dca61170))
* **clk-98:** register only the project's tracker prefixes, and list the skill everywhere ([62f1de5](https://github.com/blastin-dev/clocktopus/commit/62f1de5a107feae842589c4fcdf2b25d3071f1e8))

## [0.11.0](https://github.com/blastin-dev/clocktopus/compare/cli-v0.10.0...cli-v0.11.0) (2026-10-29)


### Features

* **clk-69:** leave review-work findings inline, each with a recommended fix ([ed06984](https://github.com/blastin-dev/clocktopus/commit/ed069847dd6400fbde8bbb7c800010642aa9122c))
* **clk-69:** leave review-work findings inline, each with a recommended fix ([81bf4b0](https://github.com/blastin-dev/clocktopus/commit/81bf4b05a19028bbf6de86330d859462dfb0eec8))
* **clk-69:** name what the work does well in review-work's review ([8d6f143](https://github.com/blastin-dev/clocktopus/commit/8d6f143e3e839c4d2aadb8764d3c6545f7d355de))
* **clk-73:** allow task summaries up to 5000 characters over MCP ([bca34b7](https://github.com/blastin-dev/clocktopus/commit/bca34b7fff6420f89de0c64f9f43d2ef85ca8df6))
* **clk-73:** allow task summaries up to 5000 characters over MCP ([0561086](https://github.com/blastin-dev/clocktopus/commit/05610862dafc1d94a99cc5b7531c0c3349753e81))


### Bug Fixes

* **clk-69:** give review-work's body fallback a format and keep its rules consistent ([fc7659f](https://github.com/blastin-dev/clocktopus/commit/fc7659fcde88f42e239ba0c652dd2cac34fe5f42))
* **clk-70:** give the shared setup the 5000-character summary limit ([c42d594](https://github.com/blastin-dev/clocktopus/commit/c42d594f30d9f7646b16314357b5f24f70c386fa))
* **clk-70:** have create-goal search for each drafted task again ([fdea2c1](https://github.com/blastin-dev/clocktopus/commit/fdea2c11f41aea7a112a4b3dfca369785de1f203))
* **clk-70:** search before the confirmation, and compare skill subfolders too ([c92fd25](https://github.com/blastin-dev/clocktopus/commit/c92fd25aec1f9cd38b4e964100f0429fbfd55394))
* **clk-76:** give the first stacked pull request the right base and keep the user's open stack linked ([7778eb2](https://github.com/blastin-dev/clocktopus/commit/7778eb201fafc0511e2744e51b267d6329957148))
* **clk-76:** have start-work's main thread stack every goal pull request ([f366eb5](https://github.com/blastin-dev/clocktopus/commit/f366eb5c7cf32741a0b6850851e9fd32968108c0))
* **clk-76:** have start-work's main thread stack every goal pull request ([26d8a20](https://github.com/blastin-dev/clocktopus/commit/26d8a20a0e3b191b664fb32dbf6a9c0aaf4ded23))

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
