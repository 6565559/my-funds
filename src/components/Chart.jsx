import { useEffect, useRef } from "react";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
} from "echarts/components";
use([
  CanvasRenderer,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
]);
export default function Chart({ option, label, className = "h-80" }) {
  const element = useRef(null);
  const chart = useRef(null);
  useEffect(() => {
    chart.current = init(element.current);
    const observer = new ResizeObserver(() => chart.current?.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    chart.current?.setOption(
      {
        ...option,
        aria: { enabled: true },
        animation: !window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
      },
      true,
    );
  }, [option]);
  return (
    <div ref={element} role="img" aria-label={label} className={className} />
  );
}
