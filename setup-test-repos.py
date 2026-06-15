"""
One-shot script to create application + app_component + service entities
for the 17 unprocessed test repos in discovery_packs.xlsx.

Run from the repo root:  python setup-test-repos.py
"""
import urllib.request
import urllib.error
import json
import time
import random
import string

BASE = 'http://localhost:8080'

ROWS = [
    ("PetClinic",            "https://github.com/spring-projects/spring-petclinic.git",        "java-lang",       "java-spring-boot",  ""),
    ("nestjs-realworld",     "https://github.com/lujakob/nestjs-realworld-example-app.git",    "typescript-lang", "nestjs",            ""),
    ("Saleor",               "https://github.com/saleor/saleor.git",                            "python-lang",     "django",            "saleor"),
    ("react-redux-realworld","https://github.com/gothinkster/react-redux-realworld-example-app.git","javascript-lang","react-javascript", ""),
    ("angular-realworld",    "https://github.com/gothinkster/angular-realworld-example-app.git","typescript-lang", "angular",           ""),
    ("WordPress",            "https://github.com/WordPress/WordPress.git",                      "php-lang",        "wordpress",         ""),
    ("eShopOnWeb",           "https://github.com/dotnet-architecture/eShopOnWeb.git",           "csharp-lang",     "asp-net-core",      "src/Web"),
    ("flask-microblog",      "https://github.com/miguelgrinberg/microblog.git",                 "python-lang",     "flask",             ""),
    ("Redmine",              "https://github.com/redmine/redmine.git",                          "ruby-lang",       "rails",             ""),
    ("Discourse",            "https://github.com/discourse/discourse.git",                      "ruby-lang",       "rails",             ""),
    ("beer-shop-go",         "https://github.com/go-kratos/beer-shop.git",                      "go-lang",         "kratos",            "app"),
    ("OrangeHRM",            "https://github.com/orangehrm/orangehrm.git",                      "php-lang",        "symfony",           "src"),
    ("eShopLegacyMVC",       "https://github.com/dotnet-architecture/eShopModernizing.git",     "csharp-lang",     "asp-net-framework", "eShopLegacyMVCSolution"),
    ("magento-lts",          "https://github.com/OpenMage/magento-lts.git",                     "php-lang",        "magento",           ""),
    ("jquery-ui",            "https://github.com/jquery/jquery-ui.git",                         "javascript-lang", "jquery",            "ui"),
    ("wxWidgets",            "https://github.com/wxWidgets/wxWidgets.git",                      "cpp-lang",        "wxwidgets",         "src"),
    ("oatpp-crud",           "https://github.com/oatpp/example-crud.git",                       "cpp-lang",        "oatpp",             "src"),
]

NAME_TO_PROJECT = {
    "PetClinic":             "fc3abaf2-19a5-466f-b3df-a6430183429e",
    "nestjs-realworld":      "747061c2-6975-429d-bcc8-9a8139dc9f8c",
    "Saleor":                "918df920-c886-402b-86e6-b71dee92dcf0",
    "react-redux-realworld": "9c6f0fb5-7a72-4eef-b868-cc18ac036a96",
    "angular-realworld":     "811f94be-b74a-4e83-a51e-699bf3f0e260",
    "WordPress":             "71b0ee8f-d8ea-41a5-a582-700828819cc3",
    "eShopOnWeb":            "a5a015bd-2fe8-43cb-9b22-ed4e39668a42",
    "flask-microblog":       "2a51d920-90ea-465b-a0a7-feb6aac509d1",
    "Redmine":               "6521e8ab-1ba1-4bf8-8119-baaef51dee07",
    "Discourse":             "5a4dc7b3-364d-4981-a494-953bd5f299cf",
    "beer-shop-go":          "0e828c3e-413b-4ccb-ad02-017dc260d018",
    "OrangeHRM":             "fd0fd396-22a0-4895-b8f8-e87cdca394df",
    "eShopLegacyMVC":        "c0dafafc-39b1-4ba2-a83a-54439dbf9f8a",
    "magento-lts":           "05b60ec7-a462-4703-ba65-26605f41b6a6",
    "jquery-ui":             "94b7a050-a8f9-4d69-b1e3-6f8c8d9a00dd",
    "wxWidgets":             "d9a57446-81ab-49bb-b62b-b7b4fbb482e7",
    "oatpp-crud":            "8e9d09e0-5b60-4355-9edd-4cab154e7eef",
}

ORIG_ACTIVE = "b6e61465-a50e-4a97-b900-0d40c9a4a513"

ALL_ENTITY_KEYS = [
    'applications','app_components','services','interfaces','endpoints',
    'classes','methods','application_points','app_business_points',
    'business_users','business_processes','process_activities','business_points',
    'logical_data_entities','logical_data_attributes',
    'physical_data_entities','physical_data_attributes','business_logics',
    'data_entity_points','events','interactions','user_journeys',
    'activities','activity_flows','activity_partitions','activity_steps',
    'states','state_transitions',
    'ui_actions','ui_characteristics','ui_components','ui_contracts','ui_screens',
    'packages','package_sets','package_set_default_rules',
]

def gen_id(prefix):
    chars = string.ascii_lowercase + string.digits
    return f"{prefix}-mo{''.join(random.choices(chars, k=6))}-{''.join(random.choices(chars, k=5))}"

def http(method, path, body=None):
    url = BASE + path
    data = None
    headers = {'Accept': 'application/json'}
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            txt = resp.read().decode('utf-8')
            return resp.getcode(), (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}

def slugify(s):
    return ''.join(c if c.isalnum() else '-' for c in s.lower()).strip('-')

def activate(project_id):
    code, body = http('POST', f'/api/projects/{project_id}/activate')
    return code

def make_service_payload(name, repo_url, lang_pack, fw_pack, subfolder, app_id, comp_id):
    svc_id = gen_id('svc')
    return {
        'id': svc_id,
        'name': name,
        'description': '',
        'application_id': app_id,
        'app_component_id': comp_id,
        'service_type': '',
        'core_tech': f'{lang_pack} + {fw_pack}',
        'repo_location': repo_url,
        'repo_subfolder': subfolder,
        'tags': '',
        'valid_from': None,
        'valid_to': None,
        'package_set_id': None,
        'is_internal': True,
        'core_tech_language_pack': lang_pack,
        'core_tech_framework_packs': [fw_pack] if fw_pack else [],
        'core_tech_resolved': {
            'language': {'name': lang_pack, 'version': ''},
            'confidence': 'high',
            'frameworks': [{'name': fw_pack, 'version': ''}] if fw_pack else [],
            'languagePack': lang_pack,
            'frameworkPacks': [fw_pack] if fw_pack else [],
            'repoCrossCheck': {
                'note': 'Auto-populated from test-repo spreadsheet (auto-test setup; no LLM resolve was run).',
                'status': 'partial',
            },
            'confirmationSentence': f'Auto-test setup: {lang_pack} + {fw_pack}.',
        },
        'core_tech_resolution_confidence': 'high',
        'core_tech_resolved_at': time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()),
    }, svc_id


def main():
    results = []
    print(f'Activating + saving {len(ROWS)} rows...')
    for (name, repo_url, lang_pack, fw_pack, subfolder) in ROWS:
        pid = NAME_TO_PROJECT[name]
        code = activate(pid)
        if code not in (200, 204):
            results.append({'name': name, 'project_id': pid, 'status': f'activate-fail-{code}', 'svc_id': None})
            print(f'  FAIL {name}: activate HTTP {code}')
            continue

        code, model = http('GET', f'/api/model?projectId={pid}')
        if code != 200:
            results.append({'name': name, 'project_id': pid, 'status': f'get-fail-{code}', 'svc_id': None})
            print(f'  FAIL {name}: GET model HTTP {code}')
            continue

        app_id = gen_id('app')
        comp_id = gen_id('comp')
        svc, svc_id = make_service_payload(name, repo_url, lang_pack, fw_pack, subfolder, app_id, comp_id)
        application = {
            'id': app_id,
            'name': name,
            'description': f'Auto-created for performance testing -- {name}',
            'app_type': '',
            'status': '',
            'tags': '',
            'valid_from': None,
            'valid_to': None,
            'is_internal': True,
            'abbreviation': name[0].upper(),
        }
        app_component = {
            'id': comp_id,
            'name': f'{name} Component',
            'description': '',
            'application_id': app_id,
            'tags': '',
            'valid_from': None,
            'valid_to': None,
            'is_internal': True,
            'tech_type': '',
        }

        ents = model.setdefault('metaModel', {}).setdefault('entities', {})
        for k in ALL_ENTITY_KEYS:
            ents.setdefault(k, [])
        ents['applications'].append(application)
        ents['app_components'].append(app_component)
        ents['services'].append(svc)

        filename = f'test-repo-{slugify(name)}.json'
        code, body = http('PUT', f'/api/model?filename={filename}', model)
        if code in (200, 201):
            results.append({
                'name': name, 'project_id': pid, 'status': 'created',
                'svc_id': svc_id, 'app_id': app_id, 'comp_id': comp_id,
                'filename': filename, 'lang_pack': lang_pack,
                'fw_pack': fw_pack, 'subfolder': subfolder,
            })
            print(f'  OK   {name}: svc={svc_id}')
        else:
            results.append({'name': name, 'project_id': pid, 'status': f'put-fail-{code}', 'svc_id': None})
            err_str = json.dumps(body)[:200] if isinstance(body, dict) else str(body)[:200]
            print(f'  FAIL {name}: PUT HTTP {code}; body: {err_str}')

    print(f'\nRestoring original active project ({ORIG_ACTIVE})...')
    activate(ORIG_ACTIVE)

    with open('test-repos-results.json', 'w') as f:
        json.dump(results, f, indent=2)
    succ = sum(1 for r in results if r['status'] == 'created')
    print(f'\n{succ}/{len(ROWS)} succeeded')
    return 0 if succ == len(ROWS) else 1

if __name__ == '__main__':
    raise SystemExit(main())
