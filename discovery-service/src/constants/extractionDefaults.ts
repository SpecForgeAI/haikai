/**
 * Extraction Default Constants
 *
 * Sensible defaults for Phase 1a universal evidence extraction.
 * These constants control file filtering, directory exclusions,
 * binary detection, and string pattern matching.
 */

/**
 * Maximum file size in bytes (1 MB).
 * Files exceeding this threshold are skipped during extraction.
 */
export const MAX_FILE_SIZE_BYTES = 1_048_576;

/**
 * Default directories excluded from extraction.
 * Applied in addition to any Phase 0 config `excludePaths`.
 */
export const DEFAULT_EXCLUDED_DIRS: string[] = [
  'node_modules',
  '.git',
  'vendor',
  'build',
  'dist',
  'target',
  '.gradle',
  '.mvn',
  '__pycache__',
  '.venv',
  'venv',
];

/**
 * File extensions identifying binary files.
 * Files with these extensions are skipped during extraction.
 */
export const BINARY_FILE_EXTENSIONS: string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.bmp',
  '.tiff',
  '.webp',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.jar',
  '.war',
  '.ear',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.class',
  '.o',
  '.obj',
  '.pyc',
  '.pyo',
  '.db',
  '.sqlite',
  '.lock',
  '.bin',
  '.dat',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
  '.flac',
];

/**
 * Shape of a string pattern definition used by the string/pattern sub-extractor.
 */
export interface StringPatternDef {
  patternName: string;
  regex: RegExp;
  fileExtensions?: string[];
}

/**
 * Default string patterns for the string/pattern sub-extractor.
 * Covers broad, language-agnostic signals for dependency, framework,
 * configuration, endpoint, and database patterns.
 */
export const DEFAULT_STRING_PATTERNS: StringPatternDef[] = [
  // Import/require statements (dependency signals)
  {
    patternName: 'import_statement',
    regex: /\bimport\s+(?:[\w{*}\s,]+\s+from\s+)?['"][^'"]+['"]/,
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.kt', '.scala', '.go', '.dart'],
  },
  {
    patternName: 'require_statement',
    regex: /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/,
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },

  // Framework markers
  {
    patternName: 'spring_boot_application',
    regex: /@SpringBootApplication/,
    fileExtensions: ['.java', '.kt'],
  },
  {
    patternName: 'spring_controller',
    regex: /@(?:Rest)?Controller/,
    fileExtensions: ['.java', '.kt'],
  },
  {
    patternName: 'spring_service',
    regex: /@Service/,
    fileExtensions: ['.java', '.kt'],
  },
  {
    patternName: 'spring_repository',
    regex: /@Repository/,
    fileExtensions: ['.java', '.kt'],
  },
  {
    patternName: 'express_app',
    regex: /\bexpress\s*\(\s*\)/,
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },
  {
    patternName: 'vue_create_app',
    regex: /\bcreateApp\s*\(/,
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.vue', '.mjs'],
  },
  {
    patternName: 'flask_app',
    regex: /\bFlask\s*\(\s*__name__\s*\)/,
    fileExtensions: ['.py'],
  },
  {
    patternName: 'django_settings',
    regex: /\bDJANGO_SETTINGS_MODULE\b/,
    fileExtensions: ['.py', '.env', '.sh'],
  },
  {
    patternName: 'react_component',
    regex: /\bReact\.createElement\b|\bReactDOM\.render\b|\bcreateRoot\b/,
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  },

  // Configuration file indicators
  {
    patternName: 'dockerfile_from',
    regex: /^FROM\s+\S+/,
    fileExtensions: ['.dockerfile'],
  },
  {
    patternName: 'docker_compose_service',
    regex: /^\s*services:\s*$/,
    fileExtensions: ['.yml', '.yaml'],
  },
  {
    patternName: 'kubernetes_kind',
    regex: /^kind:\s+(Deployment|Service|Pod|ConfigMap|Secret|Ingress|StatefulSet|DaemonSet|Job|CronJob)/,
    fileExtensions: ['.yml', '.yaml'],
  },

  // URL/endpoint patterns (HTTP verbs, route definitions)
  {
    patternName: 'http_route_definition',
    regex: /\.(get|post|put|patch|delete)\s*\(\s*['"`/]/,
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },
  {
    patternName: 'spring_request_mapping',
    regex: /@(?:Get|Post|Put|Patch|Delete|Request)Mapping/,
    fileExtensions: ['.java', '.kt'],
  },
  {
    patternName: 'api_endpoint_path',
    regex: /['"]\/api\/[^'"]+['"]/,
  },

  // Database connection patterns
  {
    patternName: 'database_connection_url',
    regex: /(?:jdbc|mongodb|mysql|postgresql|postgres|redis|amqp):\/\/[^\s'"]+/,
  },
  {
    patternName: 'orm_entity_annotation',
    regex: /@Entity|@Table|@Column|@ManyToOne|@OneToMany|@ManyToMany/,
    fileExtensions: ['.java', '.kt'],
  },
  {
    patternName: 'typeorm_decorator',
    regex: /@Entity\(\)|@Column\(\)|@PrimaryGeneratedColumn\(\)/,
    fileExtensions: ['.ts'],
  },
  {
    patternName: 'prisma_model',
    regex: /^model\s+\w+\s*\{/,
    fileExtensions: ['.prisma'],
  },
];
