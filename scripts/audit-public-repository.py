#!/usr/bin/env python3
"""Public repository guard. Findings contain locations only, never credential values.

Uses Python standard library and Git; normal startup remains Node-only.
Low-entropy fixture prose is not a confirmed secret. Provider prefixes and private
key markers are checked independently, including in fixtures.
"""
import argparse
import collections
import json
import math
import re
import subprocess
import sys
from pathlib import Path
RULES = [
    ('private-key',re.compile(rb'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----')),
    ('openai-like-key',re.compile(rb'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b')),
    ('github-token',re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b')),
    ('aws-access-id',re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b')),
    ('google-api-key',re.compile(rb'\bAIza[A-Za-z0-9_-]{30,}\b')),
    ('slack-token',re.compile(rb'\bxox[baprs]-[A-Za-z0-9-]{20,}\b')),
    ('jwt',re.compile(rb'\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{15,}\b')),
    ('credential-literal',re.compile(rb'''(?i)(?:[A-Z_]*(?:API_KEY|API_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY|CLIENT_SECRET)|["']?(?:apiKey|accessToken|refreshToken|clientSecret)["']?)[ \t]*(?:=|:)[ \t]*["']([A-Za-z0-9_./+=-]{16,})["']''')),
    ('credential-env-literal',re.compile(rb'''(?im)^[ \t]*(?:export[ \t]+)?[A-Z_]*(?:API_KEY|API_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY|CLIENT_SECRET)[ \t]*=[ \t]*([A-Za-z0-9_./+=-]{16,})[ \t]*(?:#.*)?$''')),
    ('bearer-literal',re.compile(rb'''(?i)bearer[ \t]+([A-Za-z0-9_.+=/-]{20,})''')),
    ('credential-url',re.compile(rb'''https?://[^\s/'":]{2,}:[^\s/'"@]{5,}@''')),
]


def git_output(*args):
    return subprocess.check_output(['git', *args]).decode()


def index_entries():
    entries = []
    for entry in filter(None, git_output('ls-files', '--stage', '-z').split('\0')):
        metadata, path = entry.split('\t', 1)
        mode, sha, stage = metadata.split()
        if stage != '0':
            raise SystemExit('Unresolved index; audit refused')
        entries.append(sha + ' ' + path)
    return entries


def private_paths():
    findings = []
    for path in filter(None, git_output('ls-files', '-z').split('\0')):
        name = Path(path).name.lower()
        private = (
            (name.startswith('.env') and name != '.env.example')
            or name.endswith(('.pem', '.key', '.p12', '.pfx', '.har'))
            or path.lower().startswith(('server/.', 'node_modules/'))
            or (path.lower().startswith('reference/') and path != 'reference/TABLER-LICENSE')
        )
        if private:
            findings.append({'path': path, 'rule': 'private-file-path'})
    return findings


def entropy(token):
    frequencies = collections.Counter(token)
    return -sum(count / len(token) * math.log2(count / len(token)) for count in frequencies.values())


def scan_blob(data, sha, paths):
    findings = []
    if any(path.lower().endswith('.env.example') for path in paths):
        for line_number, line in enumerate(data.splitlines(), 1):
            entry = re.match(rb'^[ \t]*[A-Z_]*(?:API_KEY|API_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY|CLIENT_SECRET)[ \t]*=(.*)$', line)
            if entry and entry.group(1).split(b'#', 1)[0].strip().strip(b"\"'"):
                findings.append({'rule': 'nonempty-example-credential', 'blob': sha, 'paths': paths, 'line': line_number})

    fixture = bool(paths) and all(
        path.startswith(('tests/', 'qa/', 'src/'))
        and ('test' in path or '/qa/' in path or path.startswith('qa/'))
        for path in paths
    )
    for rule, pattern in RULES:
        for match in pattern.finditer(data):
            token = match.group(1) if match.lastindex else match.group()
            placeholder = fixture and bool(re.search(rb'(?i)(?:^fixture-|^test-|^sk-test-|^private-key$|^test-key|^secret$|^Bearer fixture-)', token))
            if rule == 'credential-url' and fixture:
                placeholder = bool(re.search(rb':(?:secret|pass|password|private-key|private)@$', token))
            if rule in ('credential-literal', 'credential-env-literal', 'bearer-literal'):
                placeholder = placeholder or entropy(token) < 4.2 or len(token) < 24
            if not placeholder:
                findings.append({'rule': rule, 'blob': sha, 'paths': paths, 'line': data[:match.start()].count(b'\n') + 1})
    return findings


def main():
    parser = argparse.ArgumentParser(description='Audit the Git index or reachable history without printing credential values.')
    parser.add_argument('--history', action='store_true', help='Scan all reachable objects; fetch desired remote refs first.')
    parser.add_argument('--staged', action='store_true', help='Explicit alias for the default: scan all current index bytes.')
    args = parser.parse_args()
    if args.history and args.staged:
        parser.error('Choose --history or --staged')
    objects = git_output('rev-list', '--objects', '--all').splitlines() if args.history else index_entries()
    paths_by_object = {}
    for row in objects:
        sha, _, path = row.partition(' ')
        paths_by_object.setdefault(sha, [])
        if path:
            paths_by_object[sha].append(path)

    findings = []
    stats = collections.Counter()
    process = subprocess.Popen(['git', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        for sha, paths in paths_by_object.items():
            process.stdin.write((sha + '\n').encode())
            process.stdin.flush()
            header = process.stdout.readline().decode().split()
            if len(header) != 3:
                raise RuntimeError('Git object could not be read; audit refused')
            size = int(header[2])
            data = process.stdout.read(size)
            delimiter = process.stdout.read(1)
            if len(data) != size or delimiter != b'\n':
                raise RuntimeError('Incomplete Git object; audit refused')
            if header[1] != 'blob':
                continue
            stats['blobs'] += 1
            if b'\0' in data[:8192]:
                stats['binary_skipped'] += 1
                continue
            stats['text_blobs'] += 1
            findings.extend(scan_blob(data, sha, paths))
    finally:
        process.stdin.close()
        process.stdout.close()
        process.wait()
    if process.returncode:
        raise RuntimeError('Git reader failed; audit refused')

    forbidden = private_paths()
    print(json.dumps({'scope': 'all reachable refs' if args.history else 'tracked index', 'stats': dict(stats), 'findings': len(findings), 'private_paths': len(forbidden)}))
    for finding in [*forbidden, *findings]:
        print(json.dumps(finding))
    return 1 if findings or forbidden else 0


if __name__ == '__main__':
    sys.exit(main())
