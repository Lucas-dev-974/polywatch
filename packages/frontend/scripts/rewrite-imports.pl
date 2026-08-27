#!/usr/bin/env perl
#
# Réécrit les imports relatifs dans les fichiers .ts/.tsx de packages/frontend/src
# après déplacement de composants vers un sous-dossier.
#
# Usage :
#   perl rewrite-imports.pl <mapfile> <src> <dossier-cible>
#
#   <mapfile>      : fichier "nomfichier|dossier" (une entrée par ligne) décrivant
#                    où chaque composant du lot courant a été déplacé.
#   <src>          : racine du dossier src (packages/frontend/src).
#   <dossier-cible>: dossier du lot courant (charts, settings, dialogs, pages).
#
# Règles appliquées :
#   A. Pour un fichier DÉPLACÉ (sous components/<dossier-cible>/) :
#      - imports ../lib, ../api, ../hooks, ../stores  -> ../../...
#      - imports ./X (composant racine ou sous-dossier feature) -> ../X
#      - imports ./X (composant du même dossier) -> inchangé
#      - imports ./X (composant d'un autre dossier de la table) -> ../<dossier>/X
#   B. Pour un fichier NON déplacé (racine ou sous-dossier feature) :
#      - imports ./X ou ../X où X est un composant de la table -> ./<dossier>/X ou ../<dossier>/X
#
# Perl préserve les fins de ligne CRLF (contrairement à sed), ce qui évite un
# diff massif. On matche le nom complet du fichier (suivi d'un séparateur de
# chemin) pour éviter les faux positifs (ex: SimSnapshotDialog vs
# SimSnapshotSettingsDialog).

use strict;
use warnings;
use File::Basename;
use File::Find;

my ($mapfile, $src, $target_dir) = @ARGV;
die "usage: perl rewrite-imports.pl <mapfile> <src> <dossier-cible>\n"
  unless $mapfile && $src && $target_dir;

# --- Charger le mapping nom|dossier ---
my %map;
open my $fh, "<", $mapfile or die "cannot open $mapfile: $!\n";
while (<$fh>) {
  chomp;
  s/\r$//;   # retirer le \r résiduel si le mapfile est en CRLF
  my ($name, $dir) = split /\|/, $_, 2;
  $map{$name} = $dir;
}
close $fh;

# --- Utilitaires de chemins ---
sub resolve {
  my ($base, $rel) = @_;
  my @parts = split m{/}, $rel;
  my @stack = split m{/}, $base;
  for my $p (@parts) {
    if    ($p eq ".")  { next }
    elsif ($p eq "..") { pop @stack if @stack }
    else               { push @stack, $p }
  }
  return join "/", @stack;
}

sub relpath {
  my ($base, $target) = @_;
  my @b = split m{/}, $base;
  @b = () if @b == 1 && $b[0] eq ".";   # "." = répertoire vide (racine src)
  my @t = split m{/}, $target;
  my $i = 0;
  while ($i < @b && $i < @t && $b[$i] eq $t[$i]) { $i++ }
  my @up   = ("..") x (@b - $i);
  my @down = @t[$i .. $#t];
  return join "/", (@up, @down);
}

# --- Réécriture d'un chemin d'import ---
# $base : répertoire du fichier (relatif à src), $path : chemin d'import relatif
sub rewrite_import {
  my ($base, $path) = @_;
  my ($tname) = $path =~ m{([^/]+)$};
  $tname =~ s/\.(tsx|ts)$//;

  # Cas A : fichier déplacé (dans components/<target_dir>/)
  # L'import relatif actuel a été écrit depuis l'ANCIEN emplacement (racine
  # components/). On résout donc la cible depuis "components", puis on
  # recalcule le chemin relatif depuis le NOUVEL emplacement.
  if ($base =~ m{^components/\Q$target_dir\E(?:/|$)}) {
    # imports ./X où X est un composant du même dossier ET le chemin est
    # exactement ./X (pas de sous-dossier) : inchangé
    if ($path eq "./$tname" && exists $map{$tname} && $map{$tname} eq $target_dir) {
      return $path;
    }
    my $target = resolve("components", $path);
    my $newrel = relpath($base, $target);
    $newrel = "./$newrel" if $newrel !~ m{^\.\./};
    return $newrel;
  }

  # Cas B : fichier non déplacé
  if (exists $map{$tname}) {
    my $d = $map{$tname};
    my $newrel = relpath($base, "components/$d/$tname");
    $newrel = "./$newrel" if $newrel !~ m{^\.\./};
    return $newrel;
  }
  return $path;
}

# --- Réécriture d'un fichier ---
sub rewrite_file {
  my ($file) = @_;
  my $relfile = $file;
  $relfile =~ s{^\Q$src\E/}{};
  my $base = dirname($relfile);
  $base = "." if $base eq ".";

  open my $in, "<", $file or die "cannot read $file: $!\n";
  local $/;
  my $content = <$in>;
  close $in;

  my $changed = 0;
  $content =~ s{(from\s+['"]|import\(\s*['"])(\.\.?/[^'"]+)(['"])}{ my $pre=$1; my $path=$2; my $post=$3; my $newrel=rewrite_import($base,$path); if ($newrel ne $path) { $changed++; $pre.$newrel.$post } else { $pre.$path.$post } }ge;

  if ($changed) {
    open my $out, ">", $file or die "cannot write $file: $!\n";
    print $out $content;
    close $out;
    print "  $relfile : $changed import(s) réécrit(s)\n";
  }
}

# --- Parcourir tous les .ts/.tsx sous src ---
find({
  wanted => sub {
    return unless -f $_;
    return unless /\.(ts|tsx)$/;
    rewrite_file($File::Find::name);
  },
  no_chdir => 1,
}, $src);

print "Terminé.\n";
