fetch('./Ceramiclist.json')
  .then(res => res.json())
  .then(items => {
    const container = document.getElementById('product');
    container.innerHTML = '';

    const rowDiv = document.createElement('div');
    rowDiv.className = "row g-4";

    items.forEach((item) => {

      // Generate color code if missing
      if (!item.colour_code) {
        item.colour_code = Math.floor(1000 + Math.random() * 9000).toString();
      }

      const colDiv = document.createElement('div');
      colDiv.className = "col-lg-4 col-md-6 col-12";

      const card = document.createElement('div');
      card.className = "card shadow-sm h-100 text-center p-3";

      const img = document.createElement('img');
      img.src = item.image_file;
      img.alt = item.colour_name;
      img.className = "card-img-top img-fluid mb-3";
      img.style.maxHeight = "180px";
      img.style.objectFit = "contain";

      const title = document.createElement('h5');
      title.className = "card-title fw-bold mb-2";
      title.textContent = item.colour_name;

      // Patch + Code Row
      const colorRow = document.createElement('div');
      colorRow.className = "d-flex justify-content-center align-items-center gap-3 my-2";

      const patch = document.createElement('div');
      patch.style.width = "35px";
      patch.style.height = "35px";
      patch.style.borderRadius = "6px";
      patch.style.border = "1px solid #999";
      patch.style.backgroundColor = item.hex_value;

      const code = document.createElement('span');
      code.textContent = item.colour_code;
      code.style.fontSize = "1.25rem";
      code.style.fontWeight = "700";
      code.style.letterSpacing = "1px";
      code.style.color = "#000";  // 🔥 ensures visible

      colorRow.appendChild(patch);
      colorRow.appendChild(code);

      const stock = document.createElement('span');
      stock.className =
        item.stock_level === "In Stock" ? "badge bg-success mt-2" :
        item.stock_level === "Low Stock" ? "badge bg-warning text-dark mt-2" :
        "badge bg-danger mt-2";
      stock.textContent = item.stock_level;

      card.appendChild(img);
      card.appendChild(title);
      card.appendChild(colorRow);
      card.appendChild(stock);

      colDiv.appendChild(card);
      rowDiv.appendChild(colDiv);
    });

    container.appendChild(rowDiv);
  });
