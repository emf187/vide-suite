import { redirect } from "next/navigation";
import { getCtx } from "@/server/ctx";

export default async function RootIndex(): Promise<never> {
  const ctx = await getCtx();
  redirect(ctx ? "/today" : "/login");
}
