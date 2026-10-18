/** Points @/lib/supabase-server at the in-memory fake. Register before importing a service. */
const fake = new URL("./fake-supabase.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/supabase-server") return { url: fake, shortCircuit: true };
  return nextResolve(specifier, context);
}
