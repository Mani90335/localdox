# Markdown attachments

In the Markdown editor, select the paperclip (**Attach media or files**) to:

- **Upload and attach files** to import one or more files into the current workspace and insert them at the cursor.
- Choose an existing file from any folder or workspace. Search includes workspace and folder names.
- **Attach link** to embed an HTTP or HTTPS media URL.

Picker references use workspace and file IDs, so renaming or moving an attachment within its workspace preserves the reference. Uploaded files use the existing per-file and workspace storage limits.

You can also write references by hand:

```md
![Screenshot](images/screen.png)
![Recording](../media/demo.webm)
![Audio](/assets/narration.mp3)
![Shared clip](<Other workspace/Projects/Media/demo.mp4>)

![[Other workspace/Projects/Media/demo.mp4]]
@[file](notes.pdf)

![Web video](https://example.com/demo.mp4)
![Web audio](https://example.com/narration.mp3)
```

Relative paths start in the Markdown file's sidebar folder. A leading `/` starts at the workspace root. Bare filenames can find files elsewhere in the workspace; use a folder path or the picker when names repeat. Named cross-workspace references use `Workspace/Folder/File.ext`. Binned files are excluded.

Images, video and audio render inline. Other attachments use Localdox's document viewers where supported. Actual playback depends on the browser's support for the file's codec; audio and video include a download link for opening in another player.

Native media markup is also supported, including video posters and alternative sources:

```html
<video controls poster="images/poster.png">
  <source src="media/demo.webm" type="video/webm">
  <source src="media/demo.mp4" type="video/mp4">
</video>

<audio controls src="media/narration.mp3"></audio>
```

Only media attributes are interpreted. Scripts, event handlers and autoplay are not enabled by embedding HTML.

## Download HTML + Media

**Download HTML + Media** exports the full document, including sections outside the currently visible page. The export has its own responsive styles and no editor controls. The export menu’s **Web page (.html)** option uses the same packaging rules.

- A document referencing uploaded files downloads as a **ZIP** containing `index.html` and a `media/` folder. Repeated references share one asset. Extract the ZIP and open `index.html`, keeping the media folder next to it.
- A document containing only web media downloads as a single **HTML file**. Web URLs remain online; export does not download them. Viewing them still requires internet access and the remote site's permission to embed.
- Mixed documents bundle uploaded files and retain web URLs.

Missing or ambiguous local attachments stop export with an error so the downloaded page does not silently lose files. Local Markdown embeds include their nested media; circular embeds stop at a download link. Other attached documents are included with download links, with inline PDF and HTML previews where the browser supports them.
