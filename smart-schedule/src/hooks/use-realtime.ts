import { useRealtimeContext } from "@/providers/realtime-provider";

export function useRealtime() {
  return useRealtimeContext();
}
