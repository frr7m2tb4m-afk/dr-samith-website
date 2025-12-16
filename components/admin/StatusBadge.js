export default function StatusBadge({ value }) {
  const val = (value || "").toLowerCase();
  const classes = {
    paid: "pill success",
    confirmed: "pill success",
    completed: "pill success",
    pending: "pill warn",
    cancelled: "pill error",
  };
  const className = classes[val] || "pill";
  return <span className={className}>{value || "status"}</span>;
}
