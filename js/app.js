const checkButton = document.getElementById("checkButton");
const zipFile = document.getElementById("zipFile");
const report = document.getElementById("report");

checkButton.addEventListener("click", () => {

  if (!zipFile.files.length) {
    report.innerHTML = "<p>Please choose a ZIP file first.</p>";
    return;
  }

  const file = zipFile.files[0];

  report.innerHTML = `
    <p><strong>Selected project:</strong> ${file.name}</p>
    <p>The accessibility checker will analyze this project here.</p>
  `;

});
