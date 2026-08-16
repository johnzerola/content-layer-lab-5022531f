import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMetrics, refreshPostMetrics, type PostInsight } from '@/lib/metrics.functions';
import { currentUser } from '@/lib/cloud';
import { AuthGate } from '@/components/AuthGate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  BarChart3, 
  Eye, 
  Heart, 
  Share2, 
  Bookmark, 
  RefreshCcw,
  TrendingUp,
  Instagram,
  Youtube,
  PlaySquare
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line
} from 'recharts';
import { AppShell } from '@/components/AppShell';

export const Route = createFileRoute('/metricas')({
  beforeLoad: async () => {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");
  },
  errorComponent: ({ error }) => {
    if (error.message === "Unauthorized") {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center p-4">
          <AuthGate>
            <div className="hidden">Autenticado com sucesso!</div>
          </AuthGate>
        </div>
      );
    }
    return <div>Erro ao carregar métricas: {error.message}</div>;
  },
  component: MetricsPage,
});

function MetricsPage() {
  const queryClient = useQueryClient();
  const { data: metrics = [], isLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => getMetrics()
  });

  const refreshMutation = useMutation({
    mutationFn: (postId: string) => refreshPostMetrics({ data: { postId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
    }
  });

  const totalViews = metrics.reduce((acc: number, m: PostInsight) => acc + (m.views || 0), 0);
  const totalLikes = metrics.reduce((acc: number, m: PostInsight) => acc + (m.likes || 0), 0);
  const totalEngagement = metrics.reduce((acc: number, m: PostInsight) => acc + (m.likes || 0) + (m.shares || 0) + (m.saves || 0), 0);

  // Data for platform comparison
  const platformData = [
    { name: 'Instagram', views: metrics.filter((m: PostInsight) => m.platform === 'instagram').reduce((acc: number, m: PostInsight) => acc + (m.views || 0), 0) },
    { name: 'TikTok', views: metrics.filter((m: PostInsight) => m.platform === 'tiktok').reduce((acc: number, m: PostInsight) => acc + (m.views || 0), 0) },
    { name: 'YouTube', views: metrics.filter((m: PostInsight) => m.platform === 'youtube').reduce((acc: number, m: PostInsight) => acc + (m.views || 0), 0) },
  ].filter(p => p.views > 0);

  return (
    <AppShell 
      mode="external" 
      onMode={() => {}} 
      count={0} 
      onLibrary={() => {}} 
      onCloud={() => {}}
    >
      <div className="p-6 space-y-8 max-w-7xl mx-auto">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Métricas de Performance</h1>
            <p className="text-muted-foreground">Acompanhe o desempenho de seus vídeos publicados.</p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => queryClient.invalidateQueries({ queryKey: ['metrics'] })}
            disabled={isLoading}
          >
            <RefreshCcw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Views</CardTitle>
              <Eye className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalViews.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">+12% em relação ao mês anterior</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Curtidas</CardTitle>
              <Heart className="h-4 w-4 text-pink-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalLikes.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">+5% em relação ao mês anterior</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Engajamento</CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalEngagement.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Média de 4.2% por post</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Performance por Plataforma</CardTitle>
              <CardDescription>Visualizações totais comparadas entre redes sociais.</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={platformData.length > 0 ? platformData : [{name: 'Nenhum dado', views: 0}]}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                    itemStyle={{ color: '#22c55e' }}
                  />
                  <Bar dataKey="views" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Vídeos</CardTitle>
              <CardDescription>Vídeos com maior retenção e alcance.</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics.slice(0, 7).reverse()}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                  <XAxis dataKey="post_title" hide />
                  <YAxis />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                  />
                  <Line type="monotone" dataKey="views" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Recent Posts Table */}
        <Card>
          <CardHeader>
            <CardTitle>Relatório Detalhado</CardTitle>
            <CardDescription>Métricas individuais de cada publicação.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <BarChart3 className="mx-auto h-12 w-12 opacity-20 mb-4" />
                <p>Nenhuma publicação encontrada para medir métricas.</p>
              </div>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground uppercase border-b border-border/50">
                    <tr>
                      <th className="px-4 py-3">Post</th>
                      <th className="px-4 py-3">Plataforma</th>
                      <th className="px-4 py-3 text-right">Views</th>
                      <th className="px-4 py-3 text-right">Likes</th>
                      <th className="px-4 py-3 text-right">Shares</th>
                      <th className="px-4 py-3 text-right">Saves</th>
                      <th className="px-4 py-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {metrics.map((m: PostInsight) => (
                      <tr key={m.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-4 py-4 font-medium max-w-[200px] truncate">
                          {m.post_title}
                        </td>
                        <td className="px-4 py-4 capitalize">
                          <div className="flex items-center gap-2">
                            {m.platform === 'instagram' && <Instagram className="h-4 w-4 text-pink-500" />}
                            {m.platform === 'youtube' && <Youtube className="h-4 w-4 text-red-500" />}
                            {m.platform === 'tiktok' && <PlaySquare className="h-4 w-4 text-cyan-400" />}
                            {m.platform}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right">{m.views.toLocaleString()}</td>
                        <td className="px-4 py-4 text-right">{m.likes.toLocaleString()}</td>
                        <td className="px-4 py-4 text-right">{m.shares.toLocaleString()}</td>
                        <td className="px-4 py-4 text-right">{m.saves.toLocaleString()}</td>
                        <td className="px-4 py-4 text-right">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => refreshMutation.mutate(m.post_id)}
                            disabled={refreshMutation.isPending}
                          >
                            <RefreshCcw className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
