import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listUsers = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    
    // Check if the caller is an admin
    const { data: isAdmin } = await context.supabase.rpc('has_role', { 
      _user_id: context.userId, 
      _role: 'admin' 
    });

    if (!isAdmin) {
      throw new Error("Unauthorized: Only admins can list users.");
    }

    // In a real scenario, we might list from auth.users via admin client
    // Since we don't store profiles yet, we'll return a placeholder or list from a table if exists
    const { data: users, error } = await supabaseAdmin
      .from('user_roles')
      .select('user_id, role');

    if (error) throw error;
    return users;
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((data: unknown) => z.object({ 
    targetUserId: z.string().uuid(),
    role: z.enum(['admin', 'user', 'moderator'])
  }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check if the caller is an admin
    const { data: isAdmin } = await context.supabase.rpc('has_role', { 
      _user_id: context.userId, 
      _role: 'admin' 
    });

    if (!isAdmin) {
      throw new Error("Unauthorized: Only admins can manage roles.");
    }

    const { error } = await supabaseAdmin
      .from('user_roles')
      .upsert({ 
        user_id: data.targetUserId, 
        role: data.role 
      }, { onConflict: 'user_id, role' });

    if (error) throw error;
    return { success: true };
  });
