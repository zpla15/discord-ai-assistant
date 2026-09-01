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

  // git 조회 (push 제외)
  "Bash(git status*)",
  "Bash(git diff*)",
  "Bash(git log*)",
  "Bash(git branch*)",
  "Bash(git show*)",

  // 코드 수정/테스트
  "Bash(npm test*)",
  "Bash(npm run*)",
  "Bash(npm ci*)",
  "Bash(npm install*)",
  "Bash(node*)",
  "Bash(npx*)",
] as const;

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

  // 원격 저장소 반영 방지 (로컬 커밋까지는 허용, push는 사람이 검토 후 수동으로)
  "Bash(git push*)",
] as const;
