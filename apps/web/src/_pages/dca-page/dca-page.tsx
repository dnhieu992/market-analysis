import { createServerApiClient } from '@web/shared/auth/api-auth';
import { DcaPanel } from '@web/widgets/dca-panel/dca-panel';

export default async function DcaPage() {
  const api = createServerApiClient();

  const [configs, portfolios] = await Promise.all([
    api.fetchDcaConfigs().catch(() => []),
    api.fetchPortfolios().catch(() => [])
  ]);

  // Fetch active plan for each config
  const configsWithPlans = await Promise.all(
    configs.map(async (config) => {
      const data = await api.fetchDcaActivePlan(config.id).catch(() => ({
        config,
        plan: null,
        capital: { totalBudget: 0, deployedAmount: 0, remaining: 0, runnerAmount: 0, runnerAvgCost: 0 }
      }));
      return data;
    })
  );

  return (
    <div className="dca-page">
      <h1>DCA Manager</h1>
      <div className="dca-panels">
        {configsWithPlans.map((data) => (
          <DcaPanel
            key={data.config.id}
            config={data.config}
            plan={data.plan}
            capital={data.capital}
            portfolios={portfolios}
          />
        ))}
        {configsWithPlans.length === 0 && (
          <DcaPanel
            config={null}
            plan={null}
            capital={null}
            portfolios={portfolios}
          />
        )}
      </div>
    </div>
  );
}
