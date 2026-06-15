#!/bin/bash
# Batch pre-validation harness for extension packs against the Test Repos list.
# For each (repo URL, coreTech) pair: shallow-clone, run pack harness, record result.
#
# V3 shape (Spec: V3 Discovery Pipeline Foundation, Task Group 6):
#   This script drives `scripts/run-pack-local.ts`, which invokes the V3
#   entry point — `LanguagePack.extract` followed by `FrameworkPack.adapt`
#   (not the V2 `pack.enrich` path). For the 17 V2 packs that have NOT yet
#   migrated to V3 (per Spec 4), run-pack-local.ts falls back to the V2
#   `getApplicablePacks` + `pack.enrich` path so those targets keep
#   producing output during the migration window.
#
# The OpenMRS row (coreTech="Java, Spring") is the V3 parity target for
# Task Group 7 acceptance — it now drives `javaLangPack` +
# `springClassicFrameworkPack` via V3.
#
# Usage (from discovery-service/):
#   bash scripts/batch-validate-packs.sh [OUT_DIR]
#
# OUT_DIR defaults to C:/tmp/pack-validation/

set +e  # don't abort on single-repo failures

OUT_DIR="${1:-C:/tmp/pack-validation}"
REPOS_DIR="$OUT_DIR/repos"
LOGS_DIR="$OUT_DIR/logs"
SUMMARY_FILE="$OUT_DIR/summary.tsv"
mkdir -p "$REPOS_DIR" "$LOGS_DIR"

# Header for summary
echo -e "row\trepo\tcoreTech\tresult\tcount\tduration_ms\ttags" > "$SUMMARY_FILE"

# Space-separated rows of: key|repo-url|coreTech|[subfolder]
# Row 3 (openmrs) is the V3 parity target for spring-classic.
ROWS=(
  "1|spring-petclinic|github.com/spring-projects/spring-petclinic|Java, Spring Boot|"
  "2|nestjs-realworld|github.com/lujakob/nestjs-realworld-example-app|TypeScript, NestJS|"
  "3|openmrs|github.com/openmrs/openmrs-core|Java, Spring|"
  "4|saleor|github.com/saleor/saleor|Python, Django|"
  "5|react-redux-realworld|github.com/gothinkster/react-redux-realworld-example-app|JavaScript, React|"
  "6|angular-realworld|github.com/gothinkster/angular-realworld-example-app|TypeScript, Angular|"
  "7|wordpress|github.com/WordPress/WordPress|PHP, WordPress|"
  "8|eshoponweb|github.com/dotnet-architecture/eShopOnWeb|C#, ASP.NET Core|"
  "9|flask-microblog|github.com/miguelgrinberg/microblog|Python, Flask|"
  "11|redmine|github.com/redmine/redmine|Ruby, Rails|"
  "12|discourse|github.com/discourse/discourse|Ruby, Rails|"
  "13|beer-shop-go|github.com/go-kratos/beer-shop|Go, Kratos|"
  "14|orangehrm|github.com/orangehrm/orangehrm|PHP, Symfony|"
  "15|eshoplegacymvc|github.com/dotnet-architecture/eShopLegacyMVC|C#, ASP.NET|"
  "16|magento-lts|github.com/OpenMage/magento-lts|PHP, Magento|"
  "17|jquery-ui|github.com/jquery/jquery-ui|JavaScript, jQuery|"
  "19|wxwidgets|github.com/wxWidgets/wxWidgets|C++, wxWidgets|"
  "22|oatpp-crud|github.com/oatpp/example-crud|C++, Oatpp|"
)

for entry in "${ROWS[@]}"; do
  IFS='|' read -r row key url core sub <<< "$entry"
  echo ""
  echo "### row=$row  key=$key  coreTech=$core"
  repo_dir="$REPOS_DIR/$key"
  log_file="$LOGS_DIR/$key.log"

  if [[ ! -d "$repo_dir/.git" ]]; then
    echo "  cloning https://$url ..."
    git clone --depth 1 --filter=blob:limit=1m "https://$url" "$repo_dir" > "$log_file.clone" 2>&1
    rc=$?
    if [[ $rc -ne 0 ]]; then
      echo "  CLONE FAILED rc=$rc - see $log_file.clone"
      echo -e "$row\t$key\t$core\tCLONE_FAIL\t\t\t" >> "$SUMMARY_FILE"
      continue
    fi
  else
    echo "  repo already present, skipping clone"
  fi

  echo "  running V3 harness..."
  t0=$(date +%s%3N)
  npx tsx scripts/run-pack-local.ts "$repo_dir" "$core" ${sub:+"$sub"} > "$log_file" 2>&1
  rc=$?
  t1=$(date +%s%3N)
  dur=$((t1 - t0))

  if [[ $rc -ne 0 ]]; then
    echo "  HARNESS FAILED rc=$rc - see $log_file"
    echo -e "$row\t$key\t$core\tHARNESS_FAIL\t\t$dur\t" >> "$SUMMARY_FILE"
    continue
  fi

  # Extract the totals line from the log
  count=$(grep -oE 'TOTAL [0-9]+' "$log_file" | head -1 | awk '{print $2}')
  count=${count:-0}
  tags=$(grep "_addedBy=" "$log_file" | sed 's/.*_addedBy=/; /' | tr -d '\n' | sed 's/^; //')
  echo "  OK: $count candidates, tags: $tags"
  echo -e "$row\t$key\t$core\tOK\t$count\t$dur\t$tags" >> "$SUMMARY_FILE"
done

echo ""
echo "=== Done. Summary ==="
column -t -s $'\t' "$SUMMARY_FILE"
