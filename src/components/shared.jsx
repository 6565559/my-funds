import { useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Skeleton } from "./ui/skeleton";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-h-[90dvh] overflow-y-auto ${className}`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description || "修改完成后保存，取消不会更改现有数据。"}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function ConfirmAction({ action, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await action.run();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{action.title}</AlertDialogTitle>
          <AlertDialogDescription>{action.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            variant={action.destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={submit}
          >
            {busy && <Loader2 className="animate-spin" />}
            {action.label || "确认"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export function Choice({
  value,
  onChange,
  options,
  label,
  className = "",
  disabled,
}) {
  return (
    <Select value={String(value)} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, text]) => (
          <SelectItem key={id} value={String(id)}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function EmptyState({
  title = "这里还没有数据",
  description,
  children,
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 rounded-xl border bg-muted/50 p-3">
        <FolderOpen className="size-5 text-muted-foreground" />
      </div>
      <h3 className="font-medium">{title}</h3>
      {description && (
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      )}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
export function PageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="正在加载">
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}
