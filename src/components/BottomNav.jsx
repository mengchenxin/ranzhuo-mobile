import { Compass, MessageCircle, UserRound, UsersRound } from "lucide-react";

const items = [
  { id: "messages", label: "消息", icon: MessageCircle },
  { id: "contacts", label: "角色", icon: UsersRound },
  { id: "discover", label: "发现", icon: Compass },
  { id: "me", label: "我的", icon: UserRound },
];

export function BottomNav({ activeTab, onChange, unreadCount = 0 }) {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeTab === item.id;

        return (
          <button
            type="button"
            key={item.id}
            className={`bottom-nav__item ${active ? "is-active" : ""}`}
            onClick={() => onChange(item.id)}
          >
            <span className="bottom-nav__icon">
              <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
              {item.id === "messages" && unreadCount > 0 ? (
                <span className="bottom-nav__badge">{unreadCount}</span>
              ) : null}
            </span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
