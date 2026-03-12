import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Factory } from "lucide-react";

export function LoginPage() {
  const { isAuthenticated, loading, signIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated && !loading) {
      navigate("/schedule", { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Factory className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Smart Schedule</CardTitle>
          <CardDescription>
            Sign in with your organisation account to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            size="lg"
            onClick={signIn}
            disabled={loading}
          >
            {loading ? "Loading…" : "Sign in with Azure AD"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
