const checkButton = document.getElementById("checkButton");
const fixButton = document.getElementById("fixButton");
const zipFile = document.getElementById("zipFile");
const report = document.getElementById("report");

let currentProjectFile = null;
let currentRootDocuments = [];

checkButton.addEventListener("click", async () => {
  if (!zipFile.files.length) {
    showMessage("Please choose a ZIP file first.");
    return;
  }

  const file = zipFile.files[0];

  showMessage(`Reading ${file.name}...`);

  try {
    const zip = await JSZip.loadAsync(file);

    const latexFiles = [];

    for (const [filename, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;

      // Ignore common operating-system metadata files
      if (
        filename.startsWith("__MACOSX/") ||
        filename.endsWith(".DS_Store")
      ) {
        continue;
      }

      const lowerName = filename.toLowerCase();

      if (
        lowerName.endsWith(".tex") ||
        lowerName.endsWith(".sty") ||
        lowerName.endsWith(".cls")
      ) {
        const rawContent = await zipEntry.async("string");

        latexFiles.push({
          filename,
          rawContent,
          content: stripLatexComments(rawContent)
        });
      }
    }

    analyzeProject(file.name, latexFiles);

  } catch (error) {
    console.error(error);

    showMessage(
      "The ZIP file could not be read. Please make sure it is a valid LaTeX or Overleaf project ZIP."
    );
  }
});


function analyzeProject(projectName, files) {
  if (files.length === 0) {
    showMessage(
      "No .tex, .sty, or .cls files were found in this ZIP."
    );
    return;
  }

  // Find files containing \documentclass.
  // These are candidate root/main documents.
  const rootDocuments = files.filter(file =>
    /\\documentclass(?:\s*\[[^\]]*\])?\s*\{/.test(file.content)
  );

  // Search the entire project for important accessibility settings.
  const metadataFiles = files.filter(file =>
    file.content.includes("\\DocumentMetadata")
  );

  const mathMLFiles = files.filter(file =>
    /math\s*\/\s*setup\s*=\s*mathml-SE/i.test(file.content)
  );

  const luaMMLDisabledFiles = files.filter(file =>
    /math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false/i.test(
      file.content
    )
  );

  const metadataResults = rootDocuments.map(root =>
    inspectRootDocument(root)
  );

  renderReport({
    projectName,
    files,
    rootDocuments,
    metadataFiles,
    mathMLFiles,
    luaMMLDisabledFiles,
    metadataResults
  });
}


function inspectRootDocument(file) {
  const content = file.content;

  const documentClassIndex = content.search(/\\documentclass/);
  const metadataIndex = content.search(/\\DocumentMetadata/);

  let metadata = "";

  if (metadataIndex !== -1) {
    metadata = extractCommandArgument(
      content,
      metadataIndex,
      "\\DocumentMetadata"
    );
  }

  return {
    filename: file.filename,

    hasMetadata:
      metadataIndex !== -1,

    metadataBeforeDocumentClass:
      metadataIndex !== -1 &&
      documentClassIndex !== -1 &&
      metadataIndex < documentClassIndex,

    taggingOn:
      /tagging\s*=\s*on/i.test(metadata),

    ua2:
      /pdfstandard\s*=\s*ua-2/i.test(metadata),

    language:
      /lang\s*=\s*[a-z]{2}(?:-[A-Z]{2})?/i.test(metadata),

    pdf20:
      /pdfversion\s*=\s*2(?:\.0)?/i.test(metadata),

    mathMLSE:
      /math\s*\/\s*setup\s*=\s*mathml-SE/i.test(metadata)
  };
}


function extractCommandArgument(text, commandPosition, commandName) {
  let position = commandPosition + commandName.length;

  // Skip whitespace
  while (
    position < text.length &&
    /\s/.test(text[position])
  ) {
    position++;
  }

  if (text[position] !== "{") {
    return "";
  }

  let depth = 0;
  let result = "";

  for (let i = position; i < text.length; i++) {
    const char = text[i];

    if (char === "{") {
      depth++;

      // Do not include the outermost brace
      if (depth > 1) {
        result += char;
      }

      continue;
    }

    if (char === "}") {
      depth--;

      if (depth === 0) {
        return result;
      }

      result += char;
      continue;
    }

    if (depth >= 1) {
      result += char;
    }
  }

  return result;
}


function stripLatexComments(text) {
  return text
    .split("\n")
    .map(line => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== "%") continue;

        // Count consecutive backslashes immediately before %
        let backslashes = 0;

        for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) {
          backslashes++;
        }

        // An even number means % is not escaped.
        if (backslashes % 2 === 0) {
          return line.substring(0, i);
        }
      }

      return line;
    })
    .join("\n");
}


function renderReport(data) {
  report.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = `Project: ${data.projectName}`;
  report.appendChild(title);

  const summary = document.createElement("p");
  summary.textContent =
    `Analyzed ${data.files.length} LaTeX project file(s).`;
  report.appendChild(summary);


  // MAIN DOCUMENTS
  addSectionHeading("Main document detection");

  if (data.rootDocuments.length === 0) {
    addResult(
      "warning",
      "No file containing \\documentclass was found."
    );
  } else {
    addResult(
      "pass",
      `${data.rootDocuments.length} candidate main document(s) found.`
    );

    data.rootDocuments.forEach(file => {
      addDetail(file.filename);
    });
  }


  // DOCUMENT METADATA
  addSectionHeading("Document metadata");

  if (data.metadataResults.length === 0) {
    addResult(
      "warning",
      "No candidate main document was available for metadata inspection."
    );
  }

  data.metadataResults.forEach(result => {
    const heading = document.createElement("h4");
    heading.textContent = result.filename;
    report.appendChild(heading);

    addResult(
      result.hasMetadata ? "pass" : "fail",
      result.hasMetadata
        ? "\\DocumentMetadata found."
        : "\\DocumentMetadata is missing."
    );

    if (result.hasMetadata) {
      addResult(
        result.metadataBeforeDocumentClass ? "pass" : "fail",
        result.metadataBeforeDocumentClass
          ? "\\DocumentMetadata appears before \\documentclass."
          : "\\DocumentMetadata should appear before \\documentclass."
      );

      addResult(
        result.taggingOn ? "pass" : "fail",
        result.taggingOn
          ? "tagging=on found."
          : "tagging=on was not found."
      );

      addResult(
        result.ua2 ? "pass" : "warning",
        result.ua2
          ? "pdfstandard=ua-2 found."
          : "pdfstandard=ua-2 was not found."
      );

      addResult(
        result.language ? "pass" : "warning",
        result.language
          ? "Document language is declared."
          : "No document language declaration was detected."
      );

      addResult(
        result.pdf20 ? "pass" : "warning",
        result.pdf20
          ? "PDF version 2.0 is explicitly requested."
          : "pdfversion=2.0 was not detected."
      );

      addResult(
        result.mathMLSE ? "pass" : "fail",
        result.mathMLSE
          ? "MathML Structure Element setup found."
          : "math/setup=mathml-SE was not found inside \\DocumentMetadata."
      );
    }
  });


  // PROJECT-WIDE MATHML
  addSectionHeading("Math accessibility");

  if (data.mathMLFiles.length > 0) {
    addResult(
      "pass",
      "math/setup=mathml-SE was detected in the project."
    );

    data.mathMLFiles.forEach(file => {
      addDetail(file.filename);
    });
  } else {
    addResult(
      "fail",
      "math/setup=mathml-SE was not detected anywhere in the project."
    );
  }


  // LUAMML DISABLING
  addSectionHeading("LuaMML compatibility");

  if (data.luaMMLDisabledFiles.length === 0) {
    addResult(
      "pass",
      "No setting that explicitly disables LuaMML was detected."
    );
  } else {
    addResult(
      "fail",
      "LuaMML is explicitly disabled. This prevents MathML from being generated."
    );

    data.luaMMLDisabledFiles.forEach(file => {
      addDetail(
        `${file.filename} contains math/mathml/luamml/load=false`
      );
    });
  }
}


function addSectionHeading(text) {
  const heading = document.createElement("h3");
  heading.textContent = text;
  report.appendChild(heading);
}


function addResult(type, text) {
  const item = document.createElement("div");

  item.className = `result ${type}`;

  let prefix = "";

  if (type === "pass") {
    prefix = "✓ ";
  } else if (type === "fail") {
    prefix = "✕ ";
  } else {
    prefix = "⚠ ";
  }

  item.textContent = prefix + text;

  report.appendChild(item);
}


function addDetail(text) {
  const detail = document.createElement("div");

  detail.className = "detail";
  detail.textContent = text;

  report.appendChild(detail);
}


function showMessage(message) {
  report.textContent = "";

  const paragraph = document.createElement("p");
  paragraph.textContent = message;

  report.appendChild(paragraph);
}
