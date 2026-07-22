import { SignUp } from '@clerk/remix';

export default function SignUpPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-bolt-elements-background-depth-1">
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </div>
  );
}
