export default async function AdminLogin({ searchParams }) {
  const params = await searchParams;
  const error = params?.error;
  const next = params?.next || "/admin";
  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="pill-soft">Admin</div>
        <h1>Admin Login</h1>
        <p>Enter the admin password to continue.</p>
        {error ? <div className="alert error">Invalid password</div> : null}
        <form action="/api/admin/login" method="post" className="login-form">
          <input type="hidden" name="next" value={next} />
          <label>
            Password
            <input type="password" name="password" required />
          </label>
          <button className="btn" type="submit">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
