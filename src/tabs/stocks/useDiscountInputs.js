import { useMemo } from "react";
import { useDamodaranMonthly } from "../../components/MarketFairValue.jsx";
import { DAMODARAN_INPUTS, INDUSTRY_AS_OF } from "../../lib/costOfCapital.js";

// The two market inputs every cost of capital on the stock pages shares:
//   riskfree  the dashboard's own 10-year Treasury (App's treasury state, FRED
//             refreshed from FMP) when it is under ten days old; otherwise the
//             T-bond rate in Damodaran's latest monthly update; otherwise his
//             January figure
//   ERP       Damodaran's latest monthly implied premium (/api/damodaran-erp),
//             else his January figure
const fin = v => v != null && Number.isFinite(v);
export function useDiscountInputs(treasury) {
  const dm = useDamodaranMonthly();
  return useMemo(() => {
    const t10 = treasury?.DGS10;
    const d10 = t10?.lastDate || t10?.history?.[t10.history.length - 1]?.d || null;
    const fresh = fin(t10?.current) && d10 && Date.now() - Date.parse(d10) < 10 * 864e5;
    const rf = fresh ? t10.current / 100 : fin(dm?.tbond) ? dm.tbond : DAMODARAN_INPUTS.rf;
    const rfLabel = fresh ? `10-year Treasury, ${d10}` : fin(dm?.tbond) ? `10-year Treasury at Damodaran's ${dm.asOf} update` : `T-bond rate in Damodaran's ${INDUSTRY_AS_OF} data`;
    const erp = fin(dm?.erp) ? dm.erp : DAMODARAN_INPUTS.erp;
    const erpLabel = fin(dm?.erp) ? `Damodaran's implied premium, ${dm.asOf}` : `Damodaran's January premium (${INDUSTRY_AS_OF})`;
    return { rf, erp, rfLabel, erpLabel, live: !!fresh && fin(dm?.erp) };
  }, [treasury, dm]);
}
