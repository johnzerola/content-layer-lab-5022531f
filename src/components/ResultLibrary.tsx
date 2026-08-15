import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listExports, type ExportRow } from "@/lib/cloud";
import { Button } from "@/components/ui/button";
import {
  Download,
  History,
  FileVideo,
  ExternalLink,
  Calendar,
  Layers,
  Monitor,
  Search,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ResultLibrary() {
  const [exports, setExports] = useState<ExportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listExports(100)
      .then(setExports)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = exports.filter((e) =>
    (e.file_name + (e.source_name || "")).toLowerCase().includes(search.toLowerCase()),
  );

  const formatSize = (bytes: number) => {
    if (!bytes) return "---";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome do arquivo ou fonte..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="size-4" />
          {exports.length} exportações registradas
        </div>
      </div>

      {!filtered.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <FileVideo className="size-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium">Nenhum resultado encontrado</h3>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto mt-1">
            {search
              ? "Tente mudar os termos da busca."
              : "As exportações que você fizer aparecerão aqui."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((e) => (
            <Card
              key={e.id}
              className="overflow-hidden border-border/50 bg-surface/30 transition-colors hover:bg-surface/50"
            >
              <CardContent className="p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <FileVideo className="size-6" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="truncate font-medium text-sm sm:text-base">{e.file_name}</h4>
                      <Badge
                        variant="outline"
                        className="text-[10px] uppercase font-mono h-5 bg-background/50"
                      >
                        {e.mode}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {e.source_name && (
                        <span className="flex items-center gap-1">
                          <ExternalLink className="size-3" /> {e.source_name}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3" />
                        {formatDistanceToNow(new Date(e.created_at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                      {e.platform && (
                        <span className="flex items-center gap-1">
                          <Monitor className="size-3" /> {e.platform}
                        </span>
                      )}
                      {e.bytes > 0 && (
                        <span className="flex items-center gap-1 font-mono">
                          {formatSize(e.bytes)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:ml-4">
                    <Button variant="outline" size="sm" className="h-9 gap-2" disabled>
                      <Download className="size-4" /> Baixar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
