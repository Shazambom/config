// Bash cannot distinguish ESRCH from EPERM via kill's exit status.
// No signal is delivered by signal 0. Other errors stay ambiguous.
const pid = Number(process.argv[2]);
if (!Number.isSafeInteger(pid) || pid <= 1) process.exit(2);
try {
  process.kill(pid, 0);
  process.exit(0);
} catch (error) {
  process.exit(error.code === 'ESRCH' ? 1 : 2);
}
