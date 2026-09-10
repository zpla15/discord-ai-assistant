/**
 * Curated tool policy for the Discord bot's Claude Code sessions. This is
 * deliberately NOT user/env configurable: loosening it should require a code
 * change and review, not a stray environment variable.
 *
 * Design: --restricted (see ClaudeCodeProvider) strips Bash/WebFetch by
 * default and confines Read/Edit/Write to --add-dir; `tools` re-enables the
 * built-ins we actually want. Empirically verified (2026-09-01) that under
 * --permission-mode dontAsk, simple single commands (ls, df, free, uptime)
 * run without any explicit allow entry, but Claude Code's own built-in
 * safety classifier does NOT reliably auto-approve more complex/piped
 * invocations (e.g. `ps -eo ... | head -6` was denied even though it's
 * harmless) — so relying on the classifier alone is not deterministic
 * enough for the "check server status / read logs" use case. `allowedTools`
 * below explicitly pre-approves the read-only/dev commands we expect, so
 * they no longer depend on the classifier's guess; `disallowedTools` is a
 * deny-list of genuinely dangerous operations that stays blocked regardless
 * of anything else. There is no --dangerously-skip-permissions anywhere in
 * this stack.
 *
 * NOTE: Bash itself is a real shell — unlike Read/Edit/Write it is NOT
 * confined to --add-dir by the OS. The workspace boundary for shell commands
 * is this policy plus the `nova` Linux user's own permissions, not a hard
 * sandbox. Docker-based sandboxing is a reasonable future hardening step if
 * this ever needs a stronger boundary (see project plan, risk #4).
 */
export const CLAUDE_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
] as const;

// Explicitly pre-approved read-only / dev commands. These no longer depend
// on Claude Code's own permission classifier, which was found to deny some
// harmless-but-complex invocations (piped `ps`, etc). Add new safe commands
// here as real use cases surface, rather than guessing everything upfront.
export const CLAUDE_ALLOWED_TOOLS = [
  // 파일 수정. Under --permission-mode dontAsk, tools absent from this list are
  // denied — read-only tools (Read/Glob/Grep) auto-approve, but the mutating
  // ones do not, so without these entries the agent could diagnose a bug and
  // then be blocked from fixing it (empirically confirmed 2026-09-02: Edit and
  // Write were both denied on a working "fix the failing test" task).
  //
  // Safe to grant unscoped because --restricted confines the file tools to the
  // working directories (--add-dir), i.e. the channel's own workspaceDir — a
  // real boundary, unlike Bash, which --restricted does NOT confine. Writes to
  // settings, git and tool-configuration files still require human approval
  // even with these allowed.
  "Edit",
  "Write",
  "TodoWrite",

  // 서버 상태 조회
  "Bash(uptime*)",
  "Bash(free*)",
  "Bash(df*)",
  "Bash(du*)",
  "Bash(ps*)",
  "Bash(top*)",
  "Bash(vmstat*)",
  "Bash(iostat*)",
  "Bash(ss*)",
  "Bash(netstat*)",
  "Bash(who*)",
  "Bash(w)",
  "Bash(hostname*)",
  "Bash(uname*)",
  "Bash(whoami)",
  "Bash(id)",
  "Bash(nproc)",
  "Bash(lscpu*)",
  "Bash(lsblk*)",

  // Docker 상태 조회
  "Bash(docker ps*)",
  "Bash(docker logs*)",
  "Bash(docker stats*)",
  "Bash(docker inspect*)",
  "Bash(docker images*)",
  "Bash(docker compose ps*)",
  "Bash(docker compose logs*)",

  // systemd/로그 조회
  "Bash(systemctl status*)",
  "Bash(systemctl list-units*)",
  "Bash(systemctl is-active*)",
  "Bash(journalctl*)",

  // 파일/로그 열람
  "Bash(tail*)",
  "Bash(head*)",
  "Bash(cat*)",
  "Bash(less*)",
  "Bash(grep*)",
  "Bash(find*)",
  "Bash(ls*)",
  "Bash(pwd)",

  // git 조회 + 로컬/원격 작업. push는 사용자가 그때그때 명시적으로 요청한 경우에만
  // 쓰도록 CLAUDE_SYSTEM_PROMPT에서 별도로 안내함 (기술적 강제 장치는 없음).
  "Bash(git status*)",
  "Bash(git diff*)",
  "Bash(git log*)",
  "Bash(git branch*)",
  "Bash(git show*)",
  "Bash(git clone*)",
  "Bash(git pull*)",
  "Bash(git fetch*)",
  "Bash(git add*)",
  "Bash(git commit*)",
  "Bash(git checkout*)",
  "Bash(git merge*)",
  "Bash(git stash*)",
  "Bash(git push*)",

  // GitHub CLI 인증 (디바이스 코드 방식 - 사용자가 브라우저에서 직접 로그인)
  "Bash(gh --version)",
  "Bash(gh auth login*)",
  "Bash(gh auth status*)",
  "Bash(gh repo clone*)",

  // 코드 수정/테스트
  "Bash(npm test*)",
  "Bash(npm run*)",
  "Bash(npm ci*)",
  "Bash(npm install*)",
  "Bash(node*)",
  "Bash(npx*)",
] as const;

/**
 * Appended to Claude Code's own system prompt on every run.
 *
 * Why this exists: CLAUDE_ALLOWED_TOOLS matches on the *prefix of the whole
 * command string*, so a chained command like `cd /x && git status` matches no
 * entry and is denied even though `git status` alone is allowed. Left to its
 * own devices the model batches commands with && / ; / | (normally good
 * practice) and every one of those calls gets denied, so it flails and gives
 * up. Telling it the shape of the constraint up front is far cheaper than
 * loosening the policy — and loosening is not even safe here, since adding
 * e.g. `Bash(cd*)` would let `cd /tmp && rm -rf ~` slip past the deny-list,
 * which is also prefix-matched.
 */
export const CLAUDE_SYSTEM_PROMPT = [
  "당신은 Discord를 통해 이 서버를 관리하는 비서입니다. 응답은 Discord 메시지로 전달됩니다.",
  "",
  "## Bash 도구 제약 (매우 중요)",
  "이 환경의 Bash 허용 목록은 '명령어 문자열의 앞부분'으로 매칭됩니다. 따라서:",
  "- **한 번의 Bash 호출에는 명령어를 하나만** 쓰세요.",
  "- `&&`, `;`, `|`, `$(...)`로 명령을 연결하면 조각 각각이 허용되어 있어도 **전체가 거부**됩니다.",
  "- `cd`를 쓰지 말고 **절대 경로**를 직접 넘기세요. (`cd /a && ls` ❌ → `ls /a` ✅)",
  "- 여러 정보가 필요하면 Bash를 여러 번 나눠서 호출하세요. 병렬 호출도 가능합니다.",
  "",
  "## 파일 작업은 Bash 대신 전용 도구를 쓰세요",
  "Read, Glob, Grep, Edit, Write는 위 제약을 받지 않고 작업 디렉터리 안에서 자유롭게 동작합니다.",
  "파일을 읽고 찾고 고치는 일은 `cat`/`find`/`grep` 대신 이 도구들을 우선 사용하세요.",
  "",
  "## 막혔을 때",
  "권한이 거부되면 추측하거나 우회하려 하지 말고, 사용자에게 **서버에서 직접 실행해야 할 명령어를 그대로 알려주세요.**",
  "sudo, 패키지 설치, 서비스 재시작, 방화벽 변경은 설계상 항상 차단되어 있습니다 — 버그가 아닙니다.",
  "",
  "## git push",
  "git push는 도구상으로는 허용되어 있지만, 해당 메시지에서 사용자가 명시적으로 push를 요청한 경우에만 실행하세요.",
  "먼저 요청받지 않은 작업(코드 수정, clone, commit 등)을 끝냈다고 해서 임의로 push까지 이어서 하지 마세요.",
  "",
  "## 응답 형식",
  "Discord 메시지는 길면 잘립니다. 결론을 먼저 쓰고 간결하게 답하세요. 긴 로그는 핵심만 인용하세요.",
].join("\n");

export const CLAUDE_DISALLOWED_TOOLS = [
  // 권한 상승
  "Bash(sudo*)",
  "Bash(su *)",
  "Bash(pkexec*)",

  // 패키지/시스템 설치·삭제
  "Bash(apt*)",
  "Bash(apt-get*)",
  "Bash(dpkg*)",
  "Bash(snap*)",
  "Bash(yum*)",
  "Bash(dnf*)",

  // systemd 상태 변경 (status/list 등 조회는 허용)
  "Bash(systemctl start*)",
  "Bash(systemctl stop*)",
  "Bash(systemctl restart*)",
  "Bash(systemctl enable*)",
  "Bash(systemctl disable*)",
  "Bash(systemctl mask*)",
  "Bash(service * start*)",
  "Bash(service * stop*)",
  "Bash(service * restart*)",

  // 방화벽
  "Bash(ufw*)",
  "Bash(iptables*)",
  "Bash(nft*)",
  "Bash(firewall-cmd*)",

  // 파일 삭제
  "Bash(rm*)",
  "Bash(shred*)",

  // 권한/소유자 변경
  "Bash(chmod*)",
  "Bash(chown*)",

  // 프로세스/전원 제어
  "Bash(kill*)",
  "Bash(pkill*)",
  "Bash(killall*)",
  "Bash(reboot*)",
  "Bash(shutdown*)",
  "Bash(halt*)",
  "Bash(poweroff*)",

  // 계정 관리
  "Bash(passwd*)",
  "Bash(useradd*)",
  "Bash(userdel*)",
  "Bash(usermod*)",
  "Bash(groupadd*)",

  // 디스크 파괴적 작업
  "Bash(dd *)",
  "Bash(mkfs*)",
  "Bash(fdisk*)",
  "Bash(parted*)",

  // 원격 코드 실행 패턴 (curl/wget으로 받은 스크립트를 바로 셸에 넘기는 패턴)
  "Bash(curl* | sh*)",
  "Bash(curl* | bash*)",
  "Bash(wget* | sh*)",
  "Bash(wget* | bash*)",
] as const;
