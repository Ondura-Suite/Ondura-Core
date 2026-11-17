// Jenkins pipeline for Nexora (builds.mirranet.de).
//
// Runs on a Linux agent and produces:
//   - Linux:   .deb, .rpm, .AppImage
//   - Windows: NSIS installer (.exe), cross-compiled with cargo-xwin
//
// Agent requirements (Debian/Ubuntu), see README "Jenkins":
//   Rust (rustup, stable >= 1.90), Node.js >= 20,
//   libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev build-essential file
//   for Windows: nsis lld llvm clang + `cargo install --locked cargo-xwin`

pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        disableConcurrentBuilds()
        timestamps()
        timeout(time: 90, unit: 'MINUTES')
    }

    parameters {
        booleanParam(name: 'BUILD_WINDOWS', defaultValue: true, description: 'Also build the Windows installer (cross-compiled with cargo-xwin)')
        string(name: 'GRAPH_CLIENT_ID', defaultValue: '', description: 'Client id of the Entra ID app registration baked into the build (optional)')
    }

    environment {
        PATH = "${env.HOME}/.cargo/bin:${env.PATH}"
        CARGO_TERM_COLOR = 'never'
        NEXORA_GRAPH_CLIENT_ID = "${params.GRAPH_CLIENT_ID}"
        APP_DIR = 'apps/nexora'
        WIN_TARGET = 'x86_64-pc-windows-msvc'
    }

    stages {
        stage('Toolchain') {
            steps {
                sh '''
                    set -e
                    rustc --version
                    cargo --version
                    node --version
                    npm --version
                '''
            }
        }

        stage('Frontend') {
            steps {
                dir(env.APP_DIR) {
                    sh 'npm ci --no-audit --no-fund'
                    sh 'npm run build'
                }
            }
        }

        stage('Test') {
            steps {
                sh 'cargo clippy --workspace --all-targets -- -D warnings'
                sh 'cargo test --workspace'
            }
        }

        stage('Bundle Linux') {
            steps {
                dir(env.APP_DIR) {
                    sh 'npx tauri build --bundles deb,rpm,appimage'
                }
            }
        }

        stage('Bundle Windows') {
            when { expression { return params.BUILD_WINDOWS } }
            steps {
                sh '''
                    set -e
                    rustup target add "$WIN_TARGET"
                    command -v cargo-xwin >/dev/null || cargo install --locked cargo-xwin
                    command -v makensis >/dev/null || { echo "makensis missing: apt install nsis"; exit 1; }
                '''
                dir(env.APP_DIR) {
                    sh 'npx tauri build --runner cargo-xwin --target "$WIN_TARGET" --bundles nsis'
                }
            }
        }
    }

    post {
        success {
            archiveArtifacts(
                artifacts: [
                    'target/release/bundle/deb/*.deb',
                    'target/release/bundle/rpm/*.rpm',
                    'target/release/bundle/appimage/*.AppImage',
                    'target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe',
                ].join(','),
                fingerprint: true,
                allowEmptyArchive: false
            )
        }
    }
}
