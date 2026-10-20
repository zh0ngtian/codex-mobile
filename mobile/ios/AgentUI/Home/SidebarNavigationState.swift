import Foundation

enum SidebarNavigationState: Equatable {
    case loading
    case failed(String)
    case empty
    case populated

    init(loading: Bool, error: String?, empty: Bool) {
        if loading { self = .loading }
        else if let error, !error.isEmpty { self = .failed(error) }
        else { self = empty ? .empty : .populated }
    }
}
