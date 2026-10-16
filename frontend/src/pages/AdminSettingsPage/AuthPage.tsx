import SessionSection from "./SessionSection";

type Props = {
  onUnauthorized?: () => void;
};

/** How people stay signed in. */
export default function AuthPage({ onUnauthorized }: Props) {
  return <SessionSection onUnauthorized={onUnauthorized} />;
}
