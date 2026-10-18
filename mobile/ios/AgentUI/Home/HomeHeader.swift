import SwiftUI

struct HomeHeader: View {
    @Environment(AppSession.self) private var session
    @Environment(AppPreferences.self) private var preferences
    var body: some View {
        HStack {
            Spacer()
            SidebarIconButton(
                systemImage: session.searchVisible ? "xmark" : "magnifyingglass",
                title: session.searchVisible ? preferences.text("收起并清空搜索", "Close and clear search") : preferences.text("搜索会话", "Search conversations"),
                identifier: "sidebar.search", action: toggleSearch)
        }
        .padding(.leading, 16).padding(.trailing, 22).padding(.top, 6).padding(.bottom, 10)
    }
    private func toggleSearch() {
        session.searchVisible.toggle()
        if !session.searchVisible { session.searchText = "" }
    }
}
