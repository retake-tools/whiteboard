# Package archive test fixtures

Archives in this directory exist only for server-side compatibility and Package
Manager tests. They are not part of the official Whiteboard bootstrap profile or
the production `packages/bootstrap` distribution.

`video-studio-0.1.2.retakepkg` preserves the historical Video Studio package
contract needed to verify existing installations, migration, rollback, and
Package parsing after Video Studio was removed from the default distribution.
