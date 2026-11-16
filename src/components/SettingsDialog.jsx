import { useState } from "react";
import { clone } from "../calc";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Modal } from "./shared";

const PRESETS = [
  ["sh000001", "上证指数"],
  ["sz399001", "深证成指"],
  ["sz399006", "创业板指"],
  ["sh000300", "沪深300"],
  ["sh000905", "中证500"],
  ["sh000688", "科创50"],
  ["sh000922", "中证红利"],
  ["hkHSI", "恒生指数"],
  ["hkHSTECH", "恒生科技"],
  ["usNDX", "纳斯达克100"],
  ["usINX", "标普500"],
  ["usDJI", "道琼斯"],
];
export default function SettingsDialog({ portfolio, onClose, onSave }) {
  const [seconds, setSeconds] = useState(
    portfolio.settings.refreshSeconds ?? 60,
  );
  const [indices, setIndices] = useState(portfolio.settings.indices || []);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const options = [
    ...PRESETS,
    ...indices
      .filter((code) => !PRESETS.some((p) => p[0] === code))
      .map((code) => [code, code]),
  ];
  async function save(e) {
    e.preventDefault();
    setError("");
    const extra = custom.split(/[,，\s]+/).filter(Boolean);
    if (extra.some((code) => !/^(sh|sz|hk|us)[A-Za-z0-9.]+$/.test(code)))
      return setError("指数代码格式不正确，例如 sh000016、usDJI。");
    setBusy(true);
    const next = clone(portfolio);
    next.settings.refreshSeconds = Number(seconds);
    next.settings.indices = [...new Set([...indices, ...extra])];
    try {
      await onSave(next, "设置已保存");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="行情设置"
      description="调整刷新频率与关注的市场指数。"
    >
      <form onSubmit={save} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="refresh-seconds">自动刷新间隔</Label>
          <div className="flex items-center gap-3">
            <Input
              id="refresh-seconds"
              className="w-28"
              type="number"
              min="15"
              max="600"
              step="15"
              required
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">秒</span>
          </div>
          <p className="field-help">
            页面可见时自动刷新，收盘后继续获取正式净值。
          </p>
        </div>
        <fieldset>
          <legend className="mb-3 text-sm font-medium">关注的指数</legend>
          <div className="grid grid-cols-2 gap-3">
            {options.map(([code, name]) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={indices.includes(code)}
                  onCheckedChange={(checked) =>
                    setIndices((prev) =>
                      checked
                        ? [...prev, code]
                        : prev.filter((v) => v !== code),
                    )
                  }
                />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor="custom-indices">其他指数</Label>
          <Input
            id="custom-indices"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="如 sh000016，多个代码用逗号分隔"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button disabled={busy}>{busy ? "保存中…" : "保存设置"}</Button>
        </div>
      </form>
    </Modal>
  );
}
