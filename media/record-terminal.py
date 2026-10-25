#!/usr/bin/env python3
# Records a real interactive `claude` session in a pty as an asciicast v2 file,
# for media/terminal.gif. Run it in a folder Claude Code already trusts, then
# turn the recording into a GIF with agg (brew install agg):
#   python3 media/record-terminal.py /tmp/test.cast . "Run this plugin's tests with \`claude plugin test .\`" "Bash(claude plugin test:*)"
#   agg --font-family Menlo --font-size 14 --line-height 1.0 --theme github-dark --fps-cap 30 --idle-time-limit 3 /tmp/test.cast media/terminal.gif
import codecs, fcntl, json, os, pty, select, signal, struct, sys, termios, time

out_path, cwd, prompt, *allowed = sys.argv[1:]
W, H = 100, 34

pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    env = {k: v for k, v in os.environ.items() if not k.startswith('CLAUDE') and k not in ('AI_AGENT',)}
    env.update(TERM='xterm-256color', COLORTERM='truecolor', COLUMNS=str(W), LINES=str(H))
    # A blank status line and the default permission mode, so nothing of the
    # account shows beyond the banner.
    args = ['claude', prompt, '--permission-mode', 'default',
            '--settings', json.dumps({'statusLine': {'type': 'command', 'command': 'printf " "'}})]
    if allowed:
        args += ['--allowedTools', *allowed]
    os.execvpe('claude', args, env)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', H, W, 0, 0))
dec = codecs.getincrementaldecoder('utf-8')(errors='replace')
start = time.time()
events = []
last_out = start
exit_sent = 0.0

def send(s):
    os.write(fd, s.encode())

while True:
    now = time.time()
    if now - start > 180:
        break
    r, _, _ = select.select([fd], [], [], 0.1)
    if r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        text = dec.decode(data)
        events.append([round(now - start, 4), 'o', text])
        last_out = now
        # Answer the terminal queries a real terminal would.
        if '\x1b[6n' in text:
            send('\x1b[1;1R')
        if '\x1b]11;?' in text:
            send('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\')
        if '\x1b]10;?' in text:
            send('\x1b]10;rgb:d6d6/d6d6/d6d6\x1b\\')
        if '\x1b[c' in text:
            send('\x1b[?62;22c')
    # Done: quiet for a while once the turn has had time to run.
    if now - start > 25 and now - last_out > 6 and not exit_sent:
        send('\x03')
        time.sleep(0.4)
        send('\x03')
        exit_sent = now
    if exit_sent and now - exit_sent > 5:
        break

try:
    os.kill(pid, signal.SIGTERM)
except ProcessLookupError:
    pass

with open(out_path, 'w') as f:
    f.write(json.dumps({'version': 2, 'width': W, 'height': H, 'env': {'TERM': 'xterm-256color'}}) + '\n')
    kept = [e for e in events if not exit_sent or e[0] < exit_sent - start]
    for e in kept:
        f.write(json.dumps(e) + '\n')
    # Hold the final screen for a moment before the loop starts again.
    f.write(json.dumps([round(kept[-1][0] + 3, 4), 'o', '']) + '\n')
print('events', len(events), 'seconds', round(time.time() - start, 1))
