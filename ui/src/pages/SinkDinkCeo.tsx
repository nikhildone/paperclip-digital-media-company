import { SinkDinkCeoControl } from "../components/SinkDinkCeoControl";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useEffect } from "react";

export function SinkDinkCeoPage() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "SINK-DINK CEO" }]);
  }, [setBreadcrumbs]);

  return (
    <div className="space-y-6">
      <SinkDinkCeoControl />
    </div>
  );
}
