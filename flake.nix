{
  description = "Thingport development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            go
            just
            nodejs_24
            nixfmt
            postgresql_17
          ];
          shellHook = ''echo "Thingport dev shell ready"'';
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
