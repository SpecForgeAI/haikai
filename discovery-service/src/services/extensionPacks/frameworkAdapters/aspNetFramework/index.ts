/**
 * ASP.NET Framework (MVC 3/4/5 + Web API) Adapter — reuses the asp-net-core
 * adapter logic but with a wider set of recognised controller base types.
 */
import { runAspNetCoreAdapter } from '../aspNetCore';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR } from '../../languageIR';

export function runAspNetFrameworkAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  // The ASP.NET Core adapter's Controller detection already matches any class
  // whose base type ends with "Controller" or "ControllerBase", and any
  // class with [ApiController]. This covers classic MVC (Controller),
  // Web API 2 (ApiController), and API controllers.
  // Swap the _addedBy tag so provenance is distinguishable.
  const cs = runAspNetCoreAdapter(files, runId);
  for (const c of cs) {
    if (c.data && (c.data as any)._addedBy === 'aspnetcore-adapter') {
      (c.data as any)._addedBy = 'aspnet-framework-adapter';
    }
  }
  return cs;
}
