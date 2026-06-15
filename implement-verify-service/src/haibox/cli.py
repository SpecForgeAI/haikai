"""haibox CLI — a thin wrapper over haiboxd for hand-debugging and shell-out callers.

    python -m src.haibox.cli serve --source ./repo --health-path /healthz -- npm start
    python -m src.haibox.cli list
    python -m src.haibox.cli inspect box-abc123
    python -m src.haibox.cli release box-abc123
    python -m src.haibox.cli ping

Config via env: HAIBOX_URL (default http://127.0.0.1:8780), STANDARDS_API_KEY.
The CLI is a *client* — all box lifetime is owned by haiboxd, not the CLI process.
"""

from __future__ import annotations

import argparse
import json
import sys

from .client import HaiboxClient, HaiboxError


def _print(obj) -> None:
    print(json.dumps(obj, indent=2))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="haibox", description="Haikai local sandbox runner client")
    p.add_argument("--url", default=None, help="haiboxd base URL (default $HAIBOX_URL)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("serve", help="launch a box and wait until healthy")
    s.add_argument("--source", default=None, help="source dir copied into the box")
    s.add_argument("--setup", default=None, help="build/deps shell command run before serve")
    s.add_argument("--name", default=None)
    s.add_argument("--health-type", default="http", choices=["http", "tcp"])
    s.add_argument("--health-path", default="/")
    s.add_argument("--port-env", default="PORT")
    s.add_argument("--readiness-timeout", type=float, default=30.0)
    s.add_argument("--ttl", type=float, default=1800.0)
    s.add_argument("--idle", type=float, default=600.0)
    s.add_argument("--env", action="append", default=[], metavar="K=V", help="repeatable")
    s.add_argument("command", nargs=argparse.REMAINDER,
                   help="-- <command to run> (port injected as $PORT)")

    for name, help_ in (("list", "list boxes"), ("ping", "service health")):
        sub.add_parser(name, help=help_)
    for name, help_ in (("inspect", "show one box"), ("release", "stop one box"),
                        ("heartbeat", "keep a box alive")):
        sp = sub.add_parser(name, help=help_)
        sp.add_argument("box_id")
    lg = sub.add_parser("logs", help="tail a box's output")
    lg.add_argument("box_id")
    lg.add_argument("--tail", type=int, default=65536)

    # run mode (ephemeral execution)
    rn = sub.add_parser("run", help="run a command/suite; stream output; exit with its code")
    rn.add_argument("--source", default=None)
    rn.add_argument("--setup", default=None)
    rn.add_argument("--name", default=None)
    rn.add_argument("--timeout", type=float, default=1800.0)
    rn.add_argument("--env", action="append", default=[], metavar="K=V")
    rn.add_argument("--no-stream", action="store_true", help="don't stream; just wait")
    rn.add_argument("command", nargs=argparse.REMAINDER, help="-- <command/suite>")
    sub.add_parser("runs", help="list runs")
    for name, help_ in (("run-status", "show a run"), ("run-logs", "tail a run's output"),
                        ("run-rm", "delete a run")):
        sp = sub.add_parser(name, help=help_)
        sp.add_argument("run_id")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    client = HaiboxClient(base_url=args.url)
    try:
        if args.cmd == "serve":
            command = list(args.command)
            if command and command[0] == "--":
                command = command[1:]
            if not command:
                print("error: provide a command after --", file=sys.stderr)
                return 2
            env = {}
            for item in args.env:
                k, _, v = item.partition("=")
                env[k] = v
            _print(client.serve(
                command, setup=args.setup, source_dir=args.source, env=env, name=args.name,
                health_type=args.health_type, health_path=args.health_path,
                port_env=args.port_env, readiness_timeout=args.readiness_timeout,
                ttl_seconds=args.ttl, idle_seconds=args.idle,
            ))
        elif args.cmd == "logs":
            print(client.logs(args.box_id, tail=args.tail))
        elif args.cmd == "run":
            command = list(args.command)
            if command and command[0] == "--":
                command = command[1:]
            if not command:
                print("error: provide a command after --", file=sys.stderr)
                return 2
            env = {}
            for item in args.env:
                k, _, v = item.partition("=")
                env[k] = v
            on_log = None if args.no_stream else (lambda chunk: (sys.stdout.write(chunk), sys.stdout.flush()))
            rec = client.run_and_wait(
                command, source_dir=args.source, setup=args.setup, env=env,
                name=args.name, timeout_seconds=args.timeout, on_log=on_log,
            )
            print(f"\n--- run {rec['run_id']} {rec['state']} exit_code={rec['exit_code']} ---",
                  file=sys.stderr)
            return rec["exit_code"] if isinstance(rec["exit_code"], int) else 1
        elif args.cmd == "runs":
            _print(client.list_runs())
        elif args.cmd == "run-status":
            _print(client.run_status(args.run_id))
        elif args.cmd == "run-logs":
            print(client.run_logs(args.run_id))
        elif args.cmd == "run-rm":
            client.delete_run(args.run_id)
            print(f"deleted {args.run_id}")
        elif args.cmd == "list":
            _print(client.list())
        elif args.cmd == "ping":
            _print(client.healthz())
        elif args.cmd == "inspect":
            _print(client.inspect(args.box_id))
        elif args.cmd == "heartbeat":
            _print(client.heartbeat(args.box_id))
        elif args.cmd == "release":
            client.release(args.box_id)
            print(f"released {args.box_id}")
    except HaiboxError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
