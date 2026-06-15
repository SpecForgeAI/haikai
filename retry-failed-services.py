"""
Retry failed/stalled discovery runs from the first batch.

Differences from run-discovery-on-test-repos.py:
- Longer stall threshold (30 min) and hard timeout (60 min) — beer-shop-go
  legitimately took ~50 min, so the 10-min stall was too aggressive.
- Tighter target list — only the services that didn't get a meaningful score.
"""
import json
import time
import urllib.request
import urllib.error

ARCH_MODEL = 'http://localhost:8080'
DISCOVERY = 'http://localhost:8091'
ORIG_ACTIVE = 'b6e61465-a50e-4a97-b900-0d40c9a4a513'
PROGRESS = r'C:\Workspaces\SSD\architecture-store-and-diagrams\retry-progress.json'

# (name, project_id, service_id)
TARGETS = [
    ('eShopOnWeb',    'a5a015bd-2fe8-43cb-9b22-ed4e39668a42', 'svc-mo7dpzyf-o4lac'),
    ('OrangeHRM',     'fd0fd396-22a0-4895-b8f8-e87cdca394df', 'svc-mo2fwkti-2tk93'),
    ('Discourse',     '5a4dc7b3-364d-4981-a494-953bd5f299cf', 'svc-mohrmmqz-ly0yn'),
    ('eShopLegacyMVC','c0dafafc-39b1-4ba2-a83a-54439dbf9f8a', 'svc-mofvde8z-j25k3'),
    ('jquery-ui',     '94b7a050-a8f9-4d69-b1e3-6f8c8d9a00dd', 'svc-moaequpm-igk0k'),
    ('wxWidgets',     'd9a57446-81ab-49bb-b62b-b7b4fbb482e7', 'svc-movs160z-hb5wg'),
    ('oatpp-crud',    '8e9d09e0-5b60-4355-9edd-4cab154e7eef', 'svc-mo0c8iab-58e5a'),
    # angular-realworld discovery completed already but perf-score LLM crashed;
    # rerun to get a clean score row.
    ('angular-realworld', '811f94be-b74a-4e83-a51e-699bf3f0e260', 'svc-moyv6pl2-hxrbg'),
    # magento-lts hung in service-scoped LLM analysis previously; try once more.
    ('magento-lts',   '05b60ec7-a462-4703-ba65-26605f41b6a6', 'svc-moircdjc-oy1nl'),
]

POLL_INTERVAL_S = 20
HARD_TIMEOUT_S = 60 * 60  # 60 min — beer-shop-go took ~50 min before
STALL_S = 30 * 60         # 30 min idle = bail


def http(method, base, path, body=None, timeout=30):
    url = base + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {'Accept': 'application/json'}
    if data:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read().decode()
            return r.getcode(), (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}
    except Exception as e:
        return -1, {'error': str(e)}


def write_progress(results, current=None):
    payload = {
        'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'current': current,
        'completed': sum(1 for r in results if r.get('final_status') == 'COMPLETED'),
        'failed_or_stalled': sum(1 for r in results if r.get('final_status') in ('FAILED','STALLED','TIMEOUT','START_FAIL')),
        'total': len(TARGETS),
        'results': results,
    }
    with open(PROGRESS, 'w') as f:
        json.dump(payload, f, indent=2)


def poll_run(project_id, run_id):
    deadline = time.time() + HARD_TIMEOUT_S
    last_status = None
    last_step = None
    last_updated_at = None
    last_updated_seen_at = time.time()
    poll_count = 0
    while time.time() < deadline:
        poll_count += 1
        code, body = http('GET', DISCOVERY, f'/discovery/runs/{run_id}?projectId={project_id}', timeout=15)
        if code != 200 or not isinstance(body, dict):
            time.sleep(POLL_INTERVAL_S)
            continue
        status = body.get('status') or 'UNKNOWN'
        step = body.get('current_step')
        upd = body.get('updated_at')
        if status != last_status or step != last_step:
            print(f'    [poll {poll_count}] status={status} step={step}')
            last_status, last_step = status, step
        if status in ('COMPLETED', 'FAILED', 'CANCELLED'):
            return status, body
        if upd != last_updated_at:
            last_updated_at = upd
            last_updated_seen_at = time.time()
        elif time.time() - last_updated_seen_at > STALL_S:
            print(f'    [poll] STALLED — no updated_at change for {STALL_S}s')
            return 'STALLED', body
        time.sleep(POLL_INTERVAL_S)
    return 'TIMEOUT', {}


def main():
    results = []
    print(f'Retrying {len(TARGETS)} failed services')
    for i, (name, pid, sid) in enumerate(TARGETS, start=1):
        print(f'\n[{i}/{len(TARGETS)}] {name} (svc={sid})')
        result = {'name': name, 'project_id': pid, 'service_id': sid,
                  'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                  'final_status': 'PENDING'}
        results.append(result)
        write_progress(results, current=name)

        ac, _ = http('POST', ARCH_MODEL, f'/api/projects/{pid}/activate')
        if ac not in (200, 204):
            print(f'  FAIL activate -> HTTP {ac}')
            result['final_status'] = f'ACTIVATE_FAIL_{ac}'
            write_progress(results, current=None)
            continue

        code, body = http('POST', DISCOVERY, '/discovery/runs',
                          {'projectId': pid, 'serviceId': sid, 'confirmLlmSolo': True})
        if code not in (200, 201):
            print(f'  FAIL start -> HTTP {code}: {str(body)[:200]}')
            result['final_status'] = f'START_FAIL_{code}'
            result['start_body'] = body
            write_progress(results, current=None)
            continue

        run_id = body.get('id')
        result['run_id'] = run_id
        print(f'  run={run_id}')
        write_progress(results, current=name)

        t0 = time.time()
        status, _ = poll_run(pid, run_id)
        result['elapsed_s'] = int(time.time() - t0)
        result['final_status'] = status
        print(f'  Final status={status} after {result["elapsed_s"]}s')
        write_progress(results, current=None)

    http('POST', ARCH_MODEL, f'/api/projects/{ORIG_ACTIVE}/activate')
    succ = sum(1 for r in results if r['final_status'] == 'COMPLETED')
    print(f'\n{succ}/{len(TARGETS)} runs COMPLETED')
    return 0 if succ == len(TARGETS) else 1


if __name__ == '__main__':
    raise SystemExit(main())
