$body = @{
    company = "Test Architecture Project"
    sources = @(
        "https://s-pro.io/static/pdf/architecture-example.pdf",
        "https://unstats.un.org/unsdwebsite/resourceCatalog/documents/IT-Architecture/IT-Architecture-Guiding-Doc.pdf",
        "https://kth.diva-portal.org/smash/get/diva2:1641315/FULLTEXT01.pdf",
        "https://fmi.org/our-insights/building-a-capable-technology-stack",
        "https://example.com/SVT_Analytics_Software_Architecture_Document.pdf",
        "https://cordis.europa.eu/docs/projects/cnect/0-999/247/247515/080/deliverables/001-D419Pathssystemarchitecturereport.pdf",
        "https://data.rigis.org/assets/docs/2011/RI_Ent_GIS_Architecture_20110926.pdf",
        "https://docs.aws.amazon.com/security-architecture/latest/security-reference-architecture.pdf",
        "https://dedicat6g.eu/wp-content/uploads/2021/10/DEDICAT6G_D2.2_Initial-System-Architecture_v1.0.pdf"
    )
}

$headers = @{
    Authorization = "Bearer changeit"
    "Content-Type" = "application/json"
}

$json = $body | ConvertTo-Json -Depth 10

Write-Host "`n🔍 Testing Standards Extractor with 9 Architecture Sources..." -ForegroundColor Cyan
Write-Host "📂 Company: $($body.company)" -ForegroundColor Yellow
Write-Host "📄 Sources: $($body.sources.Count) documents`n" -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "http://localhost:8000/api/v1/standards/global/generate" -Method Post -Headers $headers -Body $json -TimeoutSec 600
    Write-Host "`n✅ Request successful!`n" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 5
} catch {
    Write-Host "`n❌ Request failed: $($_.Exception.Message)`n" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response body: $responseBody" -ForegroundColor Yellow
    }
}
