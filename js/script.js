/**
 * Project      : Cashboi POS (Offline + Online Sync)
 * Description  : This application allows users to make sales offline
 *                using local storage / indexedDB. When internet
 *                becomes available again, all pending invoices,
 *                customers, and inventory updates get synced automatically
 *                to the main online server.
 *
 * Key Features :
 *   ✔ Offline POS Sale Processing
 *   ✔ Auto Sync When Online
 *   ✔ Customer & Product Cache
 *   ✔ Background Queue System
 *   ✔ Fallback UI for No-Internet Scenarios
 *
 * Technology   : HTML, CSS, JavaScript, IndexedDB / LocalStorage,
 *                REST API, CodeIgniter backend
 *
 * Author       : Ali Azgor Hridoy
 * GitHub       : https://github.com/sumuhridoy2002
 * Repository   : https://github.com/sumuhridoy2002/cashboi_pos_offline_online_sync
 * Version      : 1.0.0
 * License      : MIT
 *
 * Note         : Please keep author credits and GitHub link
 *                if you reuse or redistribute this source code.
 */
$(document).ready(function () {
    document.addEventListener("contextmenu", e => e.preventDefault())
    document.onkeydown = (e) => {
        if (e.key === "F12") e.preventDefault()
        if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "C" || e.key === "J")) e.preventDefault()
        if (e.ctrlKey && e.key === "U") e.preventDefault()
    }

    $(".select2").select2()
    const token = localStorage.getItem("cashboi_token")
    const user = localStorage.getItem("cashboi_user")
    let db

    // --- Database Setup ---
    const request = indexedDB.open("CashboiOfflineDB", 2)
    request.onupgradeneeded = e => {
        let dbObj = e.target.result
        if (!dbObj.objectStoreNames.contains("sales")) dbObj.createObjectStore("sales", { keyPath: "id", autoIncrement: true })
        if (!dbObj.objectStoreNames.contains("customers")) dbObj.createObjectStore("customers", { keyPath: "customerID" })
        if (!dbObj.objectStoreNames.contains("products")) dbObj.createObjectStore("products", { keyPath: "productID" })
        if (!dbObj.objectStoreNames.contains("accounts")) dbObj.createObjectStore("accounts", { keyPath: "uid", autoIncrement: true })
    }

    request.onsuccess = e => {
        db = e.target.result
        if (!token) window.location.href = "login.html"
        else { $("#app").show(); renderSelectsFromDB(); refreshSyncStatus(); }
    };

    // --- Master Data Download ---
    $('#downloadMasterData').click(async function () {
        $('#syncOverlay').show()
        $('#syncText').text("Downloading Master Data...")
        try {
            const [cust, prod, cash, bank, mob] = await Promise.all([
                fetch("https://www.cashboi.com.bd/api/Customer/customers", { headers: { "Authorization": "Bearer " + token } }).then(r => r.json()),
                fetch("https://www.cashboi.com.bd/api/Product/products", { headers: { "Authorization": "Bearer " + token } }).then(r => r.json()),
                fetch("https://www.cashboi.com.bd/api/CashAccount/cashaccount", { headers: { "Authorization": "Bearer " + token } }).then(r => r.json()),
                fetch("https://www.cashboi.com.bd/api/BankAccount/bankaccount", { headers: { "Authorization": "Bearer " + token } }).then(r => r.json()),
                fetch("https://www.cashboi.com.bd/api/MobileAccount/mobileaccount", { headers: { "Authorization": "Bearer " + token } }).then(r => r.json())
            ])

            const tx = db.transaction(["customers", "products", "accounts"], "readwrite")
            tx.objectStore("customers").clear()
            tx.objectStore("products").clear()
            tx.objectStore("accounts").clear()

            cust.data.forEach(c => { c.customerID = parseInt(c.customerID); tx.objectStore("customers").add(c); })
            prod.data.forEach(p => { p.productID = parseInt(p.productID); tx.objectStore("products").add(p); })

            cash.data.forEach(a => tx.objectStore("accounts").add({ ...a, type: 'Cash', label: a.cashName, id: a.ca_id }))
            bank.data.forEach(a => tx.objectStore("accounts").add({ ...a, type: 'Bank', label: `${a.bankName} ${a.branchName} ${a.accountName}`, id: a.ba_id }))
            mob.data.forEach(a => tx.objectStore("accounts").add({ ...a, type: 'Mobile', label: `${a.accountName} (${a.accountNo})`, id: a.ma_id }))

            tx.oncomplete = () => {
                $('#syncOverlay').hide()
                Swal.fire("Success", "Offline Data Updated!", "success").then(() => location.reload())
            }
        } catch (e) { alert("Download failed."); $('#syncOverlay').hide(); }
    })

    // --- Render Data from indexedDB ---
    async function renderSelectsFromDB() {
        const tx = db.transaction(["customers", "products", "accounts"], "readonly")

        tx.objectStore("customers").getAll().onsuccess = e => {
            $('#customerID').empty().append(new Option("Select Customer", ""))
            e.target.result.forEach(c => $('#customerID').append(new Option(`${c.customerName} (${c.mobile})`, c.customerID)))
        }

        tx.objectStore("products").getAll().onsuccess = e => {
            $('#productID').empty().append(new Option("Select Product", ""))
            e.target.result.forEach(p => $('#productID').append(new Option(`${p.productName} - Stock: ${p.stock_quantity}`, p.productID)))
        }

        updateAccountUI()
    }

    function updateAccountUI() {
        const type = $('#accountType').val()
        db.transaction("accounts", "readonly").objectStore("accounts").getAll().onsuccess = e => {
            const dropdown = $('#accountNo').empty()
            e.target.result.filter(a => a.type === type).forEach(a => dropdown.append(new Option(a.label, a.id)))
        }
    }
    $('#accountType').on('change', updateAccountUI)

    // --- POS Logic ---
    $(document).on('change', '#productID', function () {
        const pid = $(this).val()
        if (!pid) return

        const tx = db.transaction("products", "readonly")
        tx.objectStore("products").get(parseInt(pid)).onsuccess = e => {
            const p = e.target.result
            if (!p) return

            if ($(`#qty_${p.productID}`).length) return

            $('#tbody').append(`<tr>
                        <td>${p.productName} <input type="hidden" name="pname" value="${p.productName}"><input type="hidden" name="pid" value="${p.productID}"></td>
                        <td><span class="badge badge-info">${p.stock_quantity || 0}</span></td>
                        <td><input type="number" class="form-control" onkeyup="updateRow(${p.productID})" id="qty_${p.productID}" value="1"></td>
                        <td><input type="number" class="form-control" onkeyup="updateRow(${p.productID})" id="rate_${p.productID}" value="${p.sprice}"></td>
                        <td><input type="text" class="form-control rowTotal" id="total_${p.productID}" value="${p.sprice}" readonly></td>
                        <td><button type="button" class="btn btn-danger btn-sm" onclick="$(this).closest('tr').remove(); calculateTotal();">×</button></td>
                    </tr>`)
            calculateTotal()
        }
    })

    window.updateRow = id => {
        const q = parseFloat($(`#qty_${id}`).val()) || 0
        const r = parseFloat($(`#rate_${id}`).val()) || 0
        $(`#total_${id}`).val((q * r).toFixed(2))
        calculateTotal()
    }

    window.calculateTotal = () => {
        let sub = 0; $('.rowTotal').each(function () { sub += parseFloat($(this).val()) || 0; })
        let ship = parseFloat($('#sCost').val()) || 0, vat = parseFloat($('#vCost').val()) || 0, disc = parseFloat($('#discount').val()) || 0, paid = parseFloat($('#totalprice').val()) || 0
        let grand = (sub + ship + (sub * vat / 100)) - disc
        $('#nAmount').val(grand.toFixed(2))
        $('#dAmount').val((grand - paid).toFixed(2))
    }
    $('.calc-trigger').on('keyup change', calculateTotal)

    // --- Save & Print ---
    $('#posForm').submit(function (e) {
        e.preventDefault()
        let products = [], printRows = ""

        $('#tbody tr').each(function () {
            const pid = $(this).find('input[name="pid"]').val()
            const name = $(this).find('input[name="pname"]').val()
            const qty = $(`#qty_${pid}`).val()
            const total = $(`#total_${pid}`).val()
            products.push({ product: pid, quantity: qty, uprice: $(`#rate_${pid}`).val(), tprice: total })
            printRows += `<tr><td>${name}</td><td>${qty}</td><td style="text-align:right;">${total}</td></tr>`
        })

        if (products.length === 0) return alert("Add products first")

        const saleData = {
            sale: {
                saDate: new Date().toISOString().split('T')[0],
                customer: $('#customerID').val(),
                tAmount: $('#nAmount').val(),
                pAmount: $('#totalprice').val(),
                dAmount: $('#dAmount').val(),
                acType: $('#accountType').val(),
                acNo: $('#accountNo').val(),
                note: "Offline",
                compid: JSON.parse(user).compid,
                regby: JSON.parse(user).uid,
                compname: JSON.parse(user).compname
            },
            products: products
        }

        // Set Data for Print
        $('#pDate').text(new Date().toLocaleString())
        $('#pCustomer').text($("#customerID option:selected").text())
        $('#pItems').html(printRows)
        $('#pTotals').html(`Total: ${$('#nAmount').val()}<br>Paid: ${$('#totalprice').val()}<br>Due: ${$('#dAmount').val()}`)

        // Save Data into indexedDB
        const transaction = db.transaction("sales", "readwrite")
        transaction.objectStore("sales").add(saleData)

        transaction.oncomplete = () => {
            window.print()

            window.onafterprint = function () {
                location.reload()
            }

            // As backup: if onafterprint does not work then it will reload after 2s
            setTimeout(function () {
                location.reload()
            }, 2000)
        }
    })

    // --- Sync ---
    $('#syncSalesBtn').click(async function () {
        $('#syncOverlay').show()
        const sales = await new Promise(res => db.transaction("sales").objectStore("sales").getAll().onsuccess = e => res(e.target.result))
        for (let s of sales) {
            try {
                const res = await fetch("https://www.cashboi.com.bd/api/Sale/save_sale", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
                    body: JSON.stringify({ sale: s.sale, products: s.products, })
                })
                if (res.ok) db.transaction("sales", "readwrite").objectStore("sales").delete(s.id)
            } catch (e) { }
        }
        $('#syncOverlay').hide()
        refreshSyncStatus()
        Swal.fire("Success", "All Sales Synced!", "success")
    })

    function refreshSyncStatus() {
        db.transaction("sales").objectStore("sales").count().onsuccess = e => {
            if (e.target.result > 0) { $('#pendingCount').text(e.target.result); $('#syncSalesBtn').show(); } else { $('#syncSalesBtn').hide(); }
        }
    }

    // --- Customers ---
    $('#customerBtn').click(function () {
        $('#dataModalTitle').text('Customers')
        $('#dataTable thead').html(`
            <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Mobile</th>
                <th>Address</th>
            </tr>
        `)

        const tbody = $('#dataTable tbody').empty()

        const tx = db.transaction("customers", "readonly")
        tx.objectStore("customers").getAll().onsuccess = e => {
            e.target.result.forEach(c => {
                tbody.append(`
                    <tr>
                        <td>${c.cus_id}</td>
                        <td>${c.customerName}</td>
                        <td>${c.mobile}</td>
                        <td>${c.address}</td>
                    </tr>
                `)
            })
        }

        $('#dataModal').modal('show')
    })

    // --- Products/Stock ---
    $('#stockBtn').click(function () {
        $('#dataModalTitle').text('Stock / Products')
        $('#dataTable thead').html(`
            <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Price</th>
            </tr>
        `)

        const tbody = $('#dataTable tbody').empty()

        const tx = db.transaction("products", "readonly")
        tx.objectStore("products").getAll().onsuccess = e => {
            e.target.result.forEach(p => {
                tbody.append(`
                    <tr>
                        <td>${p.productcode}</td>
                        <td>${p.productName}</td>
                        <td>${p.categoryName}</td>
                        <td><span class="badge bg-info">${p.stock_quantity}</span></td>
                        <td>${p.sprice ? Number(p.sprice).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '0.00'} BDT</td>
                    </tr>
                `)
            })
        }

        $('#dataModal').modal('show')
    })
})