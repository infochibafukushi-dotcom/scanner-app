# Scanner

スマホで書類を連続撮影し、四隅を調整して台形補正し、複数ページを1つのPDFに結合・共有できるPWAです。

## 実装済み

- スマホカメラの連続撮影（撮影後もカメラを閉じない）
- 自動撮影ロック / 端末内写真の複数選択
- 複数ページ一覧（DnD並べ替え・削除Undo）
- 四隅のドラッグ調整・ルーペ・再検出
- 台形（パース）補正 / 用紙サイズ（A3・A4・A5・名刺・Letter・自由）
- 自動 / カラー / グレー + Clean（汚れ・手書き寄り軽減）+ 本カーブ補正
- 見開きの左右分割
- 左右90度回転
- 高精細マルチショット合成
- 文字読取 / 読み上げ / 翻訳 / ChatGPT共有
- PDF / JPEG / ZIP / TXT / Word 保存・共有
- IndexedDB自動保存・初回オンボーディング
- PWA / ホーム画面追加
- GitHub Pages向け `base=/scanner-app/`

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```
