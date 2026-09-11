#!/usr/bin/env bash
# reconcile/build-report.sh — merge the source/target reconciliation CSVs
# into a per-run markdown drift report. Usage:
#   build-report.sh <staging_dir> <run_stamp>
# Expects <staging_dir>/source-counts.csv and <staging_dir>/target-counts.csv
# (table,count,max_key per line — the reconciliation.sql output).
# Exit 0 = zero drift; exit 2 = drift found (gate your cutover on this).

set -euo pipefail
STAGING_DIR="${1:?staging dir}"; RUN_STAMP="${2:?run stamp}"
SRC="${STAGING_DIR}/source-counts.csv"; TGT="${STAGING_DIR}/target-counts.csv"
OUT="${STAGING_DIR}/reconciliation-${RUN_STAMP}.md"
drift=0
{
  echo "# Reconciliation report ${RUN_STAMP}"
  echo
  echo "| table | source rows | target rows | source max key | target max key | status |"
  echo "|---|---|---|---|---|---|"
  while IFS=, read -r table s_count s_max; do
    t_line="$(grep -m1 "^${table}," "${TGT}" || true)"
    t_count="$(echo "${t_line}" | cut -d, -f2)"
    t_max="$(echo "${t_line}" | cut -d, -f3)"
    status="ok"
    if [ "${s_count}" != "${t_count}" ] || [ "${s_max}" != "${t_max}" ]; then
      status="DRIFT"; drift=1
    fi
    echo "| ${table} | ${s_count} | ${t_count:-<missing>} | ${s_max} | ${t_max:-<missing>} | ${status} |"
  done < "${SRC}"
} > "${OUT}"
echo "report: ${OUT}"
if [ "${drift}" -ne 0 ]; then echo "DRIFT FOUND"; exit 2; fi
